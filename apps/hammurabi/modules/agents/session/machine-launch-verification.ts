import { getProvider, parseProviderId } from '../providers/registry.js'
import { isTranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import { LOCAL_MACHINE_ID } from '../machines.js'
import { launchProviderWorkerSession } from '../worker-launch.js'
import type { PersistenceHelpers } from '../persistence-helpers.js'
import type { MachineLaunchRuntime } from './machine-launch.js'
import type { ProviderSessionRuntime } from './provider-runtime.js'
import type {
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

export type MachineLaunchVerificationResult =
  | {
      ok: true
      agentType: string
      host: string
      machineId: string
      sessionName: string
    }
  | { ok: false; status: number; stage: string; error: string }

interface MachineLaunchVerifierDeps {
  maxSessions: number
  sessions: Map<string, AnySession>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  machineLaunchRuntime: MachineLaunchRuntime
  getProviderRuntime(): ProviderSessionRuntime
  getPersistenceHelpers(): Pick<PersistenceHelpers, 'schedulePersistedSessionsWrite'>
}

type LaunchReadinessResult =
  | { ok: true }
  | { ok: false; status: number; stage: string; error: string }

const MACHINE_LAUNCH_READINESS_TIMEOUT_MS = 10_000

function classifyLaunchVerificationStage(
  status: number,
  body: Record<string, unknown>,
): string {
  if (body.code === 'AUTH_REQUIRED' || status === 424) {
    return 'provider-auth'
  }
  const error = typeof body.error === 'string' ? body.error : ''
  if (error.includes('Unknown host machine') || error.includes('workspace cwd')) {
    return 'machine-config'
  }
  if (error.includes('Daemon machine')) {
    return 'ssh-daemon'
  }
  if (status >= 500) {
    return 'launch'
  }
  return 'session-routing'
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readEventDetail(event: StreamJsonEvent): string | undefined {
  if (isTranscriptEnvelope(event)) {
    if (event.ev.type === 'provider.activity') {
      const data = readObject(event.ev.data)
      const rawDetail = event.ev.detail ?? data?.detail ?? data?.stderr ?? data?.text
      if (typeof rawDetail === 'string' && rawDetail.trim()) {
        return rawDetail.trim()
      }
      return event.ev.title
    }
    if (event.ev.type === 'provider.error') {
      return event.ev.message
    }
    if (event.ev.type === 'turn.end') {
      const rawError = typeof event.ev.error === 'string' ? event.ev.error : undefined
      const rawResult = typeof event.ev.result === 'string' ? event.ev.result : undefined
      return rawError ?? rawResult
    }
    return undefined
  }

  const record = event as Record<string, unknown>
  const rawText = record.text ?? record.error ?? record.message
  return typeof rawText === 'string' && rawText.trim() ? rawText.trim() : undefined
}

function isSyntheticUserEnvelope(event: StreamJsonEvent): boolean {
  if (!isTranscriptEnvelope(event)) {
    return false
  }

  if (event.source.rawEventType === 'hammurabi/user') {
    return true
  }
  if (event.ev.type === 'turn.start' && event.ev.role === 'user') {
    return true
  }
  if (event.ev.type === 'message.start' && event.ev.role === 'user') {
    return true
  }
  return false
}

function classifyReadinessEvent(event: StreamJsonEvent): LaunchReadinessResult | null {
  if (!isTranscriptEnvelope(event)) {
    const record = event as Record<string, unknown>
    if (record.type === 'error') {
      return {
        ok: false,
        status: 502,
        stage: 'launch',
        error: readEventDetail(event) ?? 'Machine launch verification failed',
      }
    }
    return null
  }

  if (isSyntheticUserEnvelope(event)) {
    return null
  }

  if (event.ev.type === 'provider.error') {
    return {
      ok: false,
      status: event.ev.classification === 'auth_required' ? 424 : 502,
      stage: event.ev.classification === 'auth_required' ? 'provider-auth' : 'launch',
      error: event.ev.message,
    }
  }

  if (event.ev.type === 'turn.end') {
    const status = typeof event.ev.status === 'string' ? event.ev.status.toLowerCase() : ''
    if (status === 'error' || status === 'failed' || status === 'cancelled') {
      return {
        ok: false,
        status: 502,
        stage: 'launch',
        error: readEventDetail(event) ?? `Provider turn ended with status ${event.ev.status}`,
      }
    }
    return { ok: true }
  }

  if (event.ev.type === 'provider.activity') {
    const title = event.ev.title?.toLowerCase() ?? ''
    if (title.includes('process exited')) {
      return {
        ok: false,
        status: 502,
        stage: 'launch',
        error: readEventDetail(event) ?? event.ev.title ?? 'Provider process exited before readiness',
      }
    }
    if (title.includes('stderr')) {
      return null
    }
    if (event.source.rawEventType === 'system') {
      return { ok: true }
    }
    return null
  }

  if (
    event.ev.type === 'turn.start'
    || event.ev.type === 'message.start'
    || event.ev.type === 'message.delta'
    || event.ev.type === 'thinking.delta'
    || event.ev.type === 'tool.start'
    || event.ev.type === 'tool.delta'
    || event.ev.type === 'tool.end'
  ) {
    return { ok: true }
  }

  return null
}

function waitForLaunchReadiness(
  deps: Pick<MachineLaunchVerifierDeps, 'sessionEventHandlers'>,
  session: StreamSession,
): Promise<LaunchReadinessResult> {
  return new Promise((resolve) => {
    let settled = false
    const existingHandlers = deps.sessionEventHandlers.get(session.name)
    const handlers = existingHandlers ?? new Set<(event: StreamJsonEvent) => void>()
    if (!existingHandlers) {
      deps.sessionEventHandlers.set(session.name, handlers)
    }

    const settle = (result: LaunchReadinessResult) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      handlers.delete(handler)
      if (!existingHandlers && handlers.size === 0) {
        deps.sessionEventHandlers.delete(session.name)
      }
      resolve(result)
    }

    const handler = (event: StreamJsonEvent) => {
      const result = classifyReadinessEvent(event)
      if (result) {
        settle(result)
      }
    }

    const timer = setTimeout(() => {
      settle({
        ok: false,
        status: 504,
        stage: 'provider-readiness',
        error: 'Machine launch verification timed out before the provider emitted a readiness signal.',
      })
    }, MACHINE_LAUNCH_READINESS_TIMEOUT_MS)
    timer.unref?.()

    handlers.add(handler)

    for (const event of session.events) {
      const result = classifyReadinessEvent(event)
      if (result) {
        settle(result)
        return
      }
    }
  })
}

export function createMachineLaunchVerifier(deps: MachineLaunchVerifierDeps) {
  return async function verifyMachineLaunch(
    machineId: string,
    options: { agentType?: string; candidateMachine?: MachineConfig } = {},
  ): Promise<MachineLaunchVerificationResult> {
    if (options.candidateMachine && options.candidateMachine.id !== machineId) {
      return {
        ok: false,
        status: 500,
        stage: 'machine-config',
        error: `Candidate machine "${options.candidateMachine.id}" does not match verification machine ID "${machineId}"`,
      }
    }

    const requestedAgentType = options.agentType?.trim()
    const parsedAgentType = requestedAgentType ? parseProviderId(requestedAgentType) : 'claude'
    if (!parsedAgentType) {
      return {
        ok: false,
        status: 400,
        stage: 'machine-config',
        error: `Unknown provider: ${requestedAgentType}`,
      }
    }
    const provider = getProvider(parsedAgentType)
    if (!provider?.capabilities.supportsWorkerDispatch) {
      return {
        ok: false,
        status: 400,
        stage: 'machine-config',
        error: `Provider ${parsedAgentType} cannot dispatch worker sessions`,
      }
    }

    const sessionName = `verify-${machineId}-${Date.now().toString(36)}`
    let launchedSession: StreamSession | undefined
    try {
      const launched = await launchProviderWorkerSession(
        {
          createProviderStreamSession: (...args) => deps.getProviderRuntime().createProviderStreamSession(...args),
          maxSessions: deps.maxSessions,
          resolveDaemonLaunchReadiness: deps.machineLaunchRuntime.resolveDaemonLaunchReadiness,
          resolveMachine: async (requestedHost) => {
            if (options.candidateMachine && requestedHost === options.candidateMachine.id) {
              return { ok: true, machine: options.candidateMachine }
            }
            return deps.machineLaunchRuntime.resolveLaunchMachine(requestedHost)
          },
          schedulePersistedSessionsWrite: () => deps.getPersistenceHelpers().schedulePersistedSessionsWrite(),
          sessions: deps.sessions,
          teardownProviderSession: (...args) => deps.getProviderRuntime().teardownProviderSession(...args),
        },
        {
          agentType: parsedAgentType,
          creator: { kind: 'human', id: 'machine-launch-verification' },
          mode: 'default',
          preferMachineCwd: true,
          requestedHost: machineId,
          sessionName,
          task: 'Machine launch verification. Start successfully, then wait for teardown.',
        },
        {
          missingCwdError: 'Machine launch verification requires the machine to have a workspace cwd',
        },
      )

      if (!launched.ok) {
        const error = typeof launched.body.error === 'string'
          ? launched.body.error
          : 'Machine launch verification failed'
        return {
          ok: false,
          status: launched.status,
          stage: classifyLaunchVerificationStage(launched.status, launched.body),
          error,
        }
      }

      launchedSession = launched.session
      const launchedHost = launchedSession.host ?? LOCAL_MACHINE_ID
      if (launchedHost !== machineId) {
        return {
          ok: false,
          status: 500,
          stage: 'session-routing',
          error: `Temporary verification session recorded host "${launchedHost}" instead of machine ID "${machineId}"`,
        }
      }

      const readiness = await waitForLaunchReadiness(deps, launchedSession)
      if (!readiness.ok) {
        return readiness
      }

      return {
        ok: true,
        agentType: parsedAgentType,
        host: launchedHost,
        machineId,
        sessionName,
      }
    } finally {
      if (launchedSession) {
        await deps.getProviderRuntime()
          .teardownProviderSession(launchedSession, 'Machine launch verification complete')
          .catch(() => undefined)
      }
      deps.sessions.delete(sessionName)
      deps.completedSessions.delete(sessionName)
      deps.exitedStreamSessions.delete(sessionName)
      deps.sessionEventHandlers.delete(sessionName)
      deps.getPersistenceHelpers().schedulePersistedSessionsWrite()
    }
  }
}
