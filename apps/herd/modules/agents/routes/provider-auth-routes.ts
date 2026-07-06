import { randomUUID } from 'node:crypto'
import { spawn as spawnChild } from 'node:child_process'
import type { Request, RequestHandler, Response, Router } from 'express'
import {
  buildClaudeCredentialPoolRemoteTokenCommand,
  buildCredentialPoolLoginCommand,
  buildProviderNativeAuthDetail,
  buildProviderReauthUrl,
  completeProviderOAuthFlow,
  prepareProviderSpawnAuth,
  ProviderAuthRequiredError,
  ProviderAuthStore,
  providerUsesManagedOAuth,
  resolveProviderAuthScopeId,
  startProviderOAuthFlow,
  type CredentialPoolCredentialReadiness,
  type CredentialPoolCredentialView,
  type CredentialPoolView,
  type ProviderAuthSnapshot,
  type CredentialPoolProvider,
  type ProviderOAuthCompleteResult,
} from '../provider-auth.js'
import type {
  AgentType,
  AgentsRouterOptions,
  AnySession,
  CredentialPoolRecoveryRequest,
  MachineConfig,
  PersistedSessionsState,
  PtyHandle,
  PtySpawner,
  SessionCreator,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'
import { parseProviderId } from '../providers/registry.js'
import { installBlockedCredentialPoolRecovery } from '../session/provider-runtime.js'

export const DEFAULT_PROVIDER_AUTH_PROBE_INTERVAL_MS = 60_000
export const DEFAULT_CREDENTIAL_LOGIN_TERMINAL_TTL_MS = 5 * 60_000
const CREDENTIAL_LOGIN_TRANSCRIPT_MAX_CHARS = 24_000
const CLAUDE_SETUP_TOKEN_TIMEOUT_MS = 60_000

interface ProviderAuthRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  sessions: Map<string, AnySession>
  providerAuthStore: ProviderAuthStore
  questStore?: AgentsRouterOptions['questStore']
  readMachineRegistry(): Promise<MachineConfig[]>
  readPersistedSessionsState(): Promise<PersistedSessionsState>
  getSpawner(): Promise<PtySpawner>
  sessionCreatorIdFromUser(req: Request): string | undefined
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  schedulePersistedSessionsWrite(): void
  markCredentialRecoveryRequest(sessionName: string, request: CredentialPoolRecoveryRequest): void
  scheduleCredentialRecoveryReplacement?(sessionName: string): void
  recoverCredentialPoolSession?(
    sessionName: string,
    request: CredentialPoolRecoveryRequest,
  ): Promise<Record<string, unknown>>
}

interface RegisteredProviderAuthRoutes {
  markProviderAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<ProviderAuthSnapshot>
  refreshProviderAuthSnapshots(): Promise<ProviderAuthSnapshot[]>
}

export function resolveProviderAuthProbeIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HERD_PROVIDER_AUTH_PROBE_INTERVAL_MS?.trim()
  if (!raw) {
    return DEFAULT_PROVIDER_AUTH_PROBE_INTERVAL_MS
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PROVIDER_AUTH_PROBE_INTERVAL_MS
}

export function resolveCredentialLoginTerminalTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HERD_CREDENTIAL_LOGIN_FLOW_TERMINAL_TTL_MS?.trim()
  if (!raw) {
    return DEFAULT_CREDENTIAL_LOGIN_TERMINAL_TTL_MS
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_CREDENTIAL_LOGIN_TERMINAL_TTL_MS
}

function firstForwardedHeader(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const first = value.split(',')[0]?.trim()
  return first && /^[a-z0-9.:-]+$/iu.test(first) ? first : null
}

function configuredProviderOAuthCallbackUrl(provider: AgentType): string | null {
  const providerSpecificKey = provider === 'codex'
    ? 'HERD_CODEX_OAUTH_CALLBACK_URL'
    : null
  const configured = (providerSpecificKey ? process.env[providerSpecificKey] : undefined)
    ?? process.env.HERD_PROVIDER_OAUTH_CALLBACK_URL
  return configured?.trim() || null
}

function inferPublicRequestOrigin(req: Request): string {
  const configuredBase = process.env.HERD_PUBLIC_BASE_URL?.trim()
    ?? process.env.HERD_PROVIDER_OAUTH_CALLBACK_BASE_URL?.trim()
  if (configuredBase) {
    return configuredBase
  }

  const proto = firstForwardedHeader(req.headers['x-forwarded-proto']) ?? req.protocol
  const host = firstForwardedHeader(req.headers['x-forwarded-host']) ?? req.get('host')
  if (!host) {
    throw new Error('Unable to infer Herd public host for provider OAuth callback')
  }
  return `${proto}://${host}`
}

function providerOAuthCallbackUrl(req: Request, provider: AgentType): string {
  const configured = configuredProviderOAuthCallbackUrl(provider)
  if (configured) {
    return configured
  }
  return new URL('/api/agents/provider-auth/oauth/callback', inferPublicRequestOrigin(req)).toString()
}

function escapeProviderOAuthHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sendProviderOAuthCallbackHtml(res: Response, statusCode: number, title: string, message: string): void {
  res
    .status(statusCode)
    .type('html')
    .set('cache-control', 'no-store')
    .send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeProviderOAuthHtml(title)}</title></head>
<body>
  <h1>${escapeProviderOAuthHtml(title)}</h1>
  <p>${escapeProviderOAuthHtml(message)}</p>
</body>
</html>`)
}

function humanCreatorId(
  sessionCreatorIdFromUser: ProviderAuthRouteDeps['sessionCreatorIdFromUser'],
  req: Request,
): SessionCreator {
  return { kind: 'human', id: sessionCreatorIdFromUser(req) }
}

function parsePoolProvider(value: unknown): CredentialPoolProvider | null {
  const provider = typeof value === 'string' ? parseProviderId(value) : null
  return provider === 'claude' || provider === 'codex' ? provider : null
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

type CredentialLoginFlowStatus =
  | 'starting'
  | 'running'
  | 'ready_local'
  | 'ready_remote'
  | 'exited'
  | 'failed'

type RemoteTokenMintStatus =
  | 'not_required'
  | 'waiting_for_login'
  | 'minting'
  | 'stored'
  | 'failed'

interface RemoteTokenMintState {
  status: RemoteTokenMintStatus
  tokenLength?: number
  error?: string
}

interface CredentialLoginFlow {
  id: string
  provider: CredentialPoolProvider
  credentialId: string
  command: string
  startedAt: string
  updatedAt: string
  expiresAt?: string
  status: CredentialLoginFlowStatus
  transcript: string
  readiness: CredentialPoolCredentialReadiness
  remoteToken: RemoteTokenMintState
  pty?: PtyHandle
  pid?: number
  exitCode?: number
  signal?: number | string
  error?: string
  mintPromise?: Promise<void>
}

interface CredentialLoginFlowDto {
  id: string
  provider: CredentialPoolProvider
  credentialId: string
  command: string
  startedAt: string
  updatedAt: string
  expiresAt?: string
  status: CredentialLoginFlowStatus
  transcript: string
  readiness: CredentialPoolCredentialReadiness
  remoteToken: RemoteTokenMintState
  pid?: number
  exitCode?: number
  signal?: number | string
  error?: string
}

interface CredentialPoolLiveSessionDto {
  name: string
  host: string
}

interface CredentialPoolRotationEventDto {
  type: 'recovered' | 'blocked'
  at: string
  provider: CredentialPoolProvider
  sessionName: string
  previousCredentialId?: string
  previousCredentialLabel?: string
  activeCredentialId?: string
  activeCredentialLabel?: string
}

type CredentialPoolRouteView = CredentialPoolView & {
  latestRotationEvent?: CredentialPoolRotationEventDto
  credentials: Array<CredentialPoolCredentialView & {
    liveSessionCount: number
    liveSessions: CredentialPoolLiveSessionDto[]
    latestRotationEvent?: CredentialPoolRotationEventDto
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flowKey(provider: CredentialPoolProvider, credentialId: string, flowId: string): string {
  return `${provider}:${credentialId}:${flowId}`
}

function redactCredentialFlowOutput(value: string): string {
  return value
    .replace(/\b(CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|access_token|refresh_token|id_token)\s*[:=]\s*["']?[^"'\s]+/giu, '$1=[redacted]')
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, '')
}

function appendCredentialFlowTranscript(flow: CredentialLoginFlow, value: string): void {
  const safe = redactCredentialFlowOutput(stripAnsi(value))
  flow.transcript = `${flow.transcript}${safe}`.slice(-CREDENTIAL_LOGIN_TRANSCRIPT_MAX_CHARS)
  flow.updatedAt = new Date().toISOString()
}

function serializeCredentialLoginFlow(flow: CredentialLoginFlow): CredentialLoginFlowDto {
  return {
    id: flow.id,
    provider: flow.provider,
    credentialId: flow.credentialId,
    command: flow.command,
    startedAt: flow.startedAt,
    updatedAt: flow.updatedAt,
    ...(flow.expiresAt ? { expiresAt: flow.expiresAt } : {}),
    status: flow.status,
    transcript: flow.transcript,
    readiness: flow.readiness,
    remoteToken: { ...flow.remoteToken },
    ...(flow.pid !== undefined ? { pid: flow.pid } : {}),
    ...(flow.exitCode !== undefined ? { exitCode: flow.exitCode } : {}),
    ...(flow.signal !== undefined ? { signal: flow.signal } : {}),
    ...(flow.error ? { error: flow.error } : {}),
  }
}

function extractClaudeSetupToken(output: string): string | null {
  const lines = stripAnsi(output)
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const assignment = /\b(?:CLAUDE_CODE_OAUTH_TOKEN|token)\b\s*[:=]\s*["']?([^"'\s]+)/iu.exec(line)
    const candidate = (assignment?.[1] ?? (/^\S{16,}$/u.test(line) ? line : '')).trim()
    if (candidate.length >= 16) {
      return candidate
    }
  }
  return null
}

function runCommandCaptureOutput(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, [...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: string[] = []
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out`))
    }, CLAUDE_SETUP_TOKEN_TIMEOUT_MS)
    timeout.unref?.()
    child.stdout?.on('data', (data: Buffer | string) => {
      chunks.push(String(data))
    })
    child.stderr?.on('data', (data: Buffer | string) => {
      chunks.push(String(data))
    })
    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolve(chunks.join(''))
        return
      }
      reject(new Error(`${command} exited with ${signal ?? code ?? 'unknown status'}`))
    })
  })
}

export function registerProviderAuthRoutes(deps: ProviderAuthRouteDeps): RegisteredProviderAuthRoutes {
  const {
    router,
    providerAuthStore,
    questStore,
    readMachineRegistry,
    readPersistedSessionsState,
    getSpawner,
    requireReadAccess,
    requireWriteAccess,
    sessionCreatorIdFromUser,
    sessions,
    appendStreamEvent,
    broadcastStreamEvent,
    schedulePersistedSessionsWrite,
    markCredentialRecoveryRequest,
  } = deps

  async function queueCredentialRecovery(
    sessionName: string | undefined,
    provider: CredentialPoolProvider,
    exhaustedId: string | undefined,
    result: Awaited<ReturnType<ProviderAuthStore['switchToNextPoolCredential']>>,
  ): Promise<Record<string, unknown> | undefined> {
    const activeCredentialId = result.activeCredential?.id
    const previousCredentialPoolId = exhaustedId ?? result.previousCredential?.id
    if (sessionName && result.blocked) {
      const session = sessions.get(sessionName)
      if (session?.kind === 'stream' && session.agentType === provider) {
        installBlockedCredentialPoolRecovery({
          providerAuthStore,
          appendStreamEvent,
          broadcastStreamEvent,
          markCredentialRecoveryRequest,
          schedulePersistedSessionsWrite,
          ...(deps.scheduleCredentialRecoveryReplacement
            ? { scheduleCredentialRecoveryReplacement: deps.scheduleCredentialRecoveryReplacement }
            : {}),
        }, session, {
          reason: exhaustedId ? 'usage_limit' : 'manual_switch',
          ...(result.blocked.earliestExhaustedUntil ? { blockedUntil: result.blocked.earliestExhaustedUntil } : {}),
        })
      } else {
        markCredentialRecoveryRequest(sessionName, {
          provider,
          ...(previousCredentialPoolId
            ? { previousCredentialPoolId }
            : {}),
          clearResumeProviderContext: true,
          reason: exhaustedId ? 'usage_limit' : 'manual_switch',
          requestedAt: new Date().toISOString(),
          ...(result.blocked.earliestExhaustedUntil ? { blockedUntil: result.blocked.earliestExhaustedUntil } : {}),
        })
      }
      return {
        status: 'blocked',
        sessionName,
        ...(result.blocked.earliestExhaustedUntil ? { blockedUntil: result.blocked.earliestExhaustedUntil } : {}),
      }
    }
    if (!sessionName || !activeCredentialId || !result.switched) {
      return undefined
    }

    const request: CredentialPoolRecoveryRequest = {
      provider,
      credentialPoolId: activeCredentialId,
      ...(previousCredentialPoolId
        ? { previousCredentialPoolId }
          : {}),
      clearResumeProviderContext: true,
      reason: exhaustedId ? 'usage_limit' : 'manual_switch',
      requestedAt: new Date().toISOString(),
    }
    markCredentialRecoveryRequest(sessionName, request)

    const session = sessions.get(sessionName)
    if (session?.kind === 'stream' && session.agentType === provider) {
      session.credentialPoolRecovery = request
    }

    const recovered = await deps.recoverCredentialPoolSession?.(sessionName, request)
    return recovered ?? {
      status: 'recovered_in_place',
      sessionName,
      credentialPoolId: request.credentialPoolId,
      clearResumeProviderContext: request.clearResumeProviderContext,
    }
  }

  async function resolvePoolSwitchSessionContext(
    sessionName: string | undefined,
    provider: CredentialPoolProvider,
  ): Promise<{ host?: string; credentialPoolId?: string }> {
    if (!sessionName) {
      return {}
    }
    const liveSession = sessions.get(sessionName)
    if (liveSession?.kind === 'stream' && liveSession.agentType === provider) {
      return {
        ...(liveSession.host ? { host: liveSession.host } : {}),
        ...(liveSession.credentialPoolId ? { credentialPoolId: liveSession.credentialPoolId } : {}),
      }
    }
    const persisted = await readPersistedSessionsState()
    const session = persisted.sessions.find((candidate) => (
      candidate.name === sessionName && candidate.agentType === provider
    ))
    return {
      ...(session?.host ? { host: session.host } : {}),
      ...(session?.credentialPoolId ? { credentialPoolId: session.credentialPoolId } : {}),
    }
  }

  async function markProviderAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<ProviderAuthSnapshot> {
    const scopeId = resolveProviderAuthScopeId(session.creator)
    const host = session.host ?? 'local'
    const managedOAuth = providerUsesManagedOAuth(session.agentType)
    const nativeAuthDetail = buildProviderNativeAuthDetail(session.agentType, host)
    const snapshot: ProviderAuthSnapshot = {
      provider: session.agentType,
      scopeId,
      host,
      status: 'auth_required',
      authMethod: managedOAuth ? 'oauth' : nativeAuthDetail ? 'login' : 'missing',
      detail: nativeAuthDetail ? `${detail} ${nativeAuthDetail}` : detail,
      lastCheckedAt: new Date().toISOString(),
      ...(managedOAuth ? { reauthUrl: buildProviderReauthUrl(session.agentType, scopeId, host) } : {}),
    }
    session.providerAuthSnapshot = snapshot
    await providerAuthStore.upsertSnapshot(snapshot)
    if (session.creator.kind === 'commander' && session.creator.id) {
      await questStore?.blockActiveForAuthRequired(session.creator.id, detail)
    }
    return snapshot
  }

  async function handleProviderAuthCompleted(result: ProviderOAuthCompleteResult): Promise<void> {
    await questStore?.unblockAuthRequired(
      result.scopeId,
      `${result.provider} provider authentication is ready`,
    )
  }

  async function refreshProviderAuthSnapshots(): Promise<ProviderAuthSnapshot[]> {
    const machines = await readMachineRegistry().catch(() => [] as MachineConfig[])
    const machineById = new Map(machines.map((machine) => [machine.id, machine]))
    const seen = new Set<string>()
    const snapshots: ProviderAuthSnapshot[] = []

    for (const session of sessions.values()) {
      if (session.kind !== 'stream') {
        continue
      }
      const scopeId = resolveProviderAuthScopeId(session.creator)
      const host = session.host ?? 'local'
      const key = `${session.agentType}:${scopeId}:${host}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const machine = session.host
        ? machineById.get(session.host) ?? {
          id: session.host,
          label: session.host,
          host: null,
        } satisfies MachineConfig
        : undefined

      try {
        const providerAuth = await prepareProviderSpawnAuth({
          provider: session.agentType,
          scopeId,
          machine,
          store: providerAuthStore,
          mode: 'probe',
        })
        session.providerAuthSnapshot = providerAuth.snapshot
        snapshots.push(providerAuth.snapshot)
        if (
          providerAuth.snapshot.status === 'auth_required'
          && session.creator.kind === 'commander'
          && session.creator.id
        ) {
          await questStore?.blockActiveForAuthRequired(
            session.creator.id,
            providerAuth.snapshot.detail ?? 'Provider authentication is required',
          )
        }
        if (
          providerAuth.snapshot.status === 'ready'
          && session.creator.kind === 'commander'
          && session.creator.id
        ) {
          await questStore?.unblockAuthRequired(
            session.creator.id,
            `${session.agentType} provider authentication is ready`,
          )
        }
      } catch (error) {
        if (error instanceof ProviderAuthRequiredError) {
          snapshots.push(await markProviderAuthRequired(session, error.message))
          continue
        }
        console.warn(
          '[agents/provider-auth] failed to refresh auth snapshot',
          { provider: session.agentType, scopeId, host, error: error instanceof Error ? error.message : String(error) },
        )
      }
    }

    return snapshots.length > 0 ? snapshots : providerAuthStore.listSnapshots()
  }

  async function startReauthFlowForRequest(
    req: Request,
    provider: AgentType,
    scopeId: string,
    host: string,
  ) {
    return startProviderOAuthFlow({
      provider,
      scopeId,
      host,
      store: providerAuthStore,
      callbackUrl: providerOAuthCallbackUrl(req, provider),
    })
  }

  const credentialLoginTerminalTtlMs = resolveCredentialLoginTerminalTtlMs()
  const credentialLoginFlows = new Map<string, CredentialLoginFlow>()

  async function readCredentialForFlow(
    provider: CredentialPoolProvider,
    credentialId: string,
  ): Promise<CredentialPoolCredentialView> {
    const credential = await providerAuthStore.getPoolCredential(provider, credentialId)
    if (!credential) {
      throw new Error(`Credential "${credentialId}" is not registered for ${provider}`)
    }
    return credential
  }

  async function mintClaudeRemoteToken(flow: CredentialLoginFlow, credential: CredentialPoolCredentialView): Promise<void> {
    if (flow.remoteToken.status === 'stored') {
      return
    }
    if (flow.remoteToken.status === 'minting') {
      if (flow.mintPromise) {
        await flow.mintPromise
      }
      return
    }
    flow.remoteToken = { status: 'minting' }
    flow.status = 'ready_local'
    flow.updatedAt = new Date().toISOString()
    const tokenCommand = buildClaudeCredentialPoolRemoteTokenCommand(credential.absoluteDir)
    flow.mintPromise = runCommandCaptureOutput(tokenCommand.command, tokenCommand.args, tokenCommand.env)
      .then(async (output) => {
        const token = extractClaudeSetupToken(output)
        if (!token) {
          throw new Error('Claude setup-token did not return a remote token')
        }
        await providerAuthStore.putPoolCredentialRemoteToken('claude', flow.credentialId, token)
        flow.remoteToken = { status: 'stored', tokenLength: token.length }
        const refreshed = await readCredentialForFlow(flow.provider, flow.credentialId)
        flow.readiness = refreshed.readiness
        flow.status = refreshed.readyRemote ? 'ready_remote' : 'ready_local'
        appendCredentialFlowTranscript(flow, `\n[herd] remote token minted; length=${token.length}\n`)
      })
      .catch((error) => {
        flow.remoteToken = {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Claude setup-token failed',
        }
        flow.updatedAt = new Date().toISOString()
      })
      .finally(() => {
        flow.mintPromise = undefined
      })
    return flow.mintPromise
  }

  async function refreshCredentialLoginFlow(flow: CredentialLoginFlow, options: { waitForMint?: boolean; retryMint?: boolean } = {}): Promise<void> {
    if (options.waitForMint && flow.mintPromise) {
      await flow.mintPromise
    }
    const credential = await readCredentialForFlow(flow.provider, flow.credentialId)
    flow.readiness = credential.readiness
    if (flow.provider !== 'claude') {
      flow.remoteToken = { status: 'not_required' }
    } else if (credential.remoteTokenPresent) {
      flow.remoteToken = {
        status: 'stored',
        ...(credential.remoteTokenLength !== undefined ? { tokenLength: credential.remoteTokenLength } : {}),
      }
    } else if (!flow.readiness.readyLocal) {
      flow.remoteToken = { status: 'waiting_for_login' }
    }

    if (flow.readiness.readyRemote) {
      flow.status = 'ready_remote'
    } else if (flow.readiness.readyLocal) {
      flow.status = 'ready_local'
    } else if (flow.status !== 'failed' && flow.status !== 'exited') {
      flow.status = flow.pty ? 'running' : 'starting'
    }
    flow.updatedAt = new Date().toISOString()

    const shouldMintClaudeToken = flow.provider === 'claude'
      && flow.readiness.readyLocal
      && !flow.readiness.readyRemote
      && (flow.remoteToken.status === 'waiting_for_login' || (options.retryMint && flow.remoteToken.status === 'failed'))
    if (shouldMintClaudeToken) {
      const promise = mintClaudeRemoteToken(flow, credential)
      if (options.waitForMint) {
        await promise
      }
    }
    updateCredentialLoginFlowExpiry(flow)
  }

  function isTerminalCredentialLoginFlow(flow: CredentialLoginFlow): boolean {
    return flow.status === 'ready_remote'
      || flow.status === 'failed'
      || flow.status === 'exited'
  }

  function updateCredentialLoginFlowExpiry(flow: CredentialLoginFlow): void {
    if (!isTerminalCredentialLoginFlow(flow)) {
      flow.expiresAt = undefined
      return
    }
    flow.expiresAt ??= new Date(Date.now() + credentialLoginTerminalTtlMs).toISOString()
  }

  function pruneCredentialLoginFlows(now = Date.now()): void {
    for (const [key, flow] of credentialLoginFlows) {
      if (!flow.expiresAt) {
        continue
      }
      const expiresAt = Date.parse(flow.expiresAt)
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        credentialLoginFlows.delete(key)
      }
    }
  }

  function stopCredentialLoginFlowsForCredential(
    provider: CredentialPoolProvider,
    credentialId: string,
  ): void {
    for (const [key, flow] of credentialLoginFlows) {
      if (flow.provider !== provider || flow.credentialId !== credentialId) {
        continue
      }
      const pty = flow.pty
      if (pty) {
        pty.kill('SIGTERM')
        flow.pty = undefined
      }
      credentialLoginFlows.delete(key)
    }
  }

  async function startCredentialLoginFlow(
    provider: CredentialPoolProvider,
    credentialId: string,
  ): Promise<CredentialLoginFlow> {
    pruneCredentialLoginFlows()
    const credential = await readCredentialForFlow(provider, credentialId)
    const login = buildCredentialPoolLoginCommand(provider, credential.absoluteDir)
    const now = new Date().toISOString()
    const flow: CredentialLoginFlow = {
      id: randomUUID(),
      provider,
      credentialId,
      command: login.display,
      startedAt: now,
      updatedAt: now,
      status: 'starting',
      transcript: `$ ${login.display}\n`,
      readiness: credential.readiness,
      remoteToken: provider === 'claude'
        ? (credential.remoteTokenPresent
            ? {
                status: 'stored',
                ...(credential.remoteTokenLength !== undefined ? { tokenLength: credential.remoteTokenLength } : {}),
              }
            : { status: 'waiting_for_login' })
        : { status: 'not_required' },
    }
    const key = flowKey(provider, credentialId, flow.id)
    credentialLoginFlows.set(key, flow)

    const pty = (await getSpawner()).spawn(login.command, login.args, {
      name: 'xterm-256color',
      cols: 96,
      rows: 24,
      cwd: process.cwd(),
      env: { ...process.env, ...login.env },
    })
    flow.pty = pty
    flow.pid = pty.pid
    flow.status = 'running'
    flow.updatedAt = new Date().toISOString()
    pty.onData((data) => {
      appendCredentialFlowTranscript(flow, data)
      void refreshCredentialLoginFlow(flow).catch((error) => {
        flow.error = error instanceof Error ? error.message : 'Credential readiness refresh failed'
      })
    })
    pty.onExit((event) => {
      flow.exitCode = event.exitCode
      flow.signal = event.signal
      flow.pty = undefined
      if (event.exitCode !== 0 && !flow.readiness.readyLocal) {
        flow.status = 'failed'
        flow.error = `Login command exited with ${event.signal ?? event.exitCode}`
      } else if (!flow.readiness.readyRemote) {
        flow.status = 'exited'
      }
      flow.updatedAt = new Date().toISOString()
      void refreshCredentialLoginFlow(flow).catch((error) => {
        flow.error = error instanceof Error ? error.message : 'Credential readiness refresh failed'
      })
    })
    await refreshCredentialLoginFlow(flow)
    return flow
  }

  function lookupCredentialLoginFlow(
    provider: CredentialPoolProvider,
    credentialId: string,
    flowId: string,
  ): CredentialLoginFlow | null {
    pruneCredentialLoginFlows()
    return credentialLoginFlows.get(flowKey(provider, credentialId, flowId)) ?? null
  }

  function rotationEventTime(event: StreamJsonEvent, fallback: string): string {
    if (isRecord(event) && typeof event.time === 'string' && event.time.trim()) {
      return event.time
    }
    if (isRecord(event) && typeof event.timestamp === 'string' && event.timestamp.trim()) {
      return event.timestamp
    }
    return fallback
  }

  function readRotationEvent(
    event: StreamJsonEvent,
    sessionName: string,
    fallbackTime: string,
    labelByCredentialId: ReadonlyMap<string, string>,
  ): CredentialPoolRotationEventDto | null {
    if (isRecord(event) && event.type === 'system' && event.subtype === 'credential_pool_recovery') {
      const previousCredentialId = parseOptionalString(event.previousCredentialId)
      const activeCredentialId = parseOptionalString(event.activeCredentialId)
      const provider = parsePoolProvider(event.provider)
      if (!provider || (!previousCredentialId && !activeCredentialId)) {
        return null
      }
      return {
        type: 'recovered',
        at: rotationEventTime(event, fallbackTime),
        provider,
        sessionName,
        ...(previousCredentialId ? {
          previousCredentialId,
          previousCredentialLabel: labelByCredentialId.get(previousCredentialId) ?? previousCredentialId,
        } : {}),
        ...(activeCredentialId ? {
          activeCredentialId,
          activeCredentialLabel: labelByCredentialId.get(activeCredentialId) ?? activeCredentialId,
        } : {}),
      }
    }

    if (isRecord(event) && isRecord(event.ev) && event.ev.code === 'credential_pool_exhausted') {
      const data = isRecord(event.ev.data) ? event.ev.data : {}
      const provider = parsePoolProvider(data.provider)
      const previousCredentialId = parseOptionalString(data.credentialPoolId)
      if (!provider || !previousCredentialId) {
        return null
      }
      return {
        type: 'blocked',
        at: rotationEventTime(event, fallbackTime),
        provider,
        sessionName,
        previousCredentialId,
        previousCredentialLabel: labelByCredentialId.get(previousCredentialId) ?? previousCredentialId,
      }
    }

    return null
  }

  function newerRotationEvent(
    current: CredentialPoolRotationEventDto | undefined,
    candidate: CredentialPoolRotationEventDto,
  ): CredentialPoolRotationEventDto {
    if (!current) {
      return candidate
    }
    return Date.parse(candidate.at) >= Date.parse(current.at) ? candidate : current
  }

  async function buildCredentialPoolRouteView(provider: CredentialPoolProvider): Promise<CredentialPoolRouteView> {
    const pool = await providerAuthStore.listPoolCredentials(provider)
    const labelByCredentialId = new Map(pool.credentials.map((credential) => [credential.id, credential.label]))
    const liveSessionsByCredentialId = new Map<string, CredentialPoolLiveSessionDto[]>()
    const rotationByCredentialId = new Map<string, CredentialPoolRotationEventDto>()
    let latestRotationEvent: CredentialPoolRotationEventDto | undefined

    const scanSessionEvents = (
      sessionName: string,
      fallbackTime: string,
      events: readonly StreamJsonEvent[] | undefined,
    ) => {
      for (const event of events ?? []) {
        const rotation = readRotationEvent(event, sessionName, fallbackTime, labelByCredentialId)
        if (!rotation || rotation.provider !== provider) {
          continue
        }
        latestRotationEvent = newerRotationEvent(latestRotationEvent, rotation)
        for (const credentialId of [rotation.previousCredentialId, rotation.activeCredentialId]) {
          if (!credentialId) {
            continue
          }
          rotationByCredentialId.set(
            credentialId,
            newerRotationEvent(rotationByCredentialId.get(credentialId), rotation),
          )
        }
      }
    }

    for (const session of sessions.values()) {
      if (session.kind === 'stream' && session.agentType === provider) {
        if (session.credentialPoolId) {
          const entries = liveSessionsByCredentialId.get(session.credentialPoolId) ?? []
          entries.push({
            name: session.name,
            host: session.host ?? 'local',
          })
          liveSessionsByCredentialId.set(session.credentialPoolId, entries)
        }
        scanSessionEvents(session.name, session.lastEventAt ?? session.createdAt, session.events)
      }
    }

    const persisted = await readPersistedSessionsState().catch(() => ({ sessions: [] }))
    for (const session of persisted.sessions) {
      if (session.agentType !== provider || sessions.has(session.name)) {
        continue
      }
      scanSessionEvents(session.name, session.createdAt, session.events)
    }

    const credentials = pool.credentials.map((credential) => {
      const liveSessions = liveSessionsByCredentialId.get(credential.id) ?? []
      const latestCredentialRotation = rotationByCredentialId.get(credential.id)
      return {
        ...credential,
        liveSessionCount: liveSessions.length,
        liveSessions,
        ...(latestCredentialRotation ? { latestRotationEvent: latestCredentialRotation } : {}),
      }
    })

    return {
      ...pool,
      credentials,
      ...(pool.nextCredential ? {
        nextCredential: credentials.find((credential) => credential.id === pool.nextCredential?.id) ?? pool.nextCredential,
      } : {}),
      ...(latestRotationEvent ? { latestRotationEvent } : {}),
    }
  }

  router.get('/provider-auth/snapshots', requireReadAccess, async (_req, res) => {
    try {
      res.json({ snapshots: await providerAuthStore.listSnapshots() })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read provider auth snapshots'
      res.status(500).json({ error: message })
    }
  })

  router.post('/provider-auth/probe', requireReadAccess, async (_req, res) => {
    try {
      res.json({ snapshots: await refreshProviderAuthSnapshots() })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh provider auth snapshots'
      res.status(500).json({ error: message })
    }
  })

  router.get('/provider-auth/pool/:provider', requireReadAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid credential pool provider' })
      return
    }
    try {
      res.json(await buildCredentialPoolRouteView(provider))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read credential pool'
      res.status(500).json({ error: message })
    }
  })

  router.post('/provider-auth/pool/credentials', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.body?.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid credential pool provider' })
      return
    }
    try {
      const result = await providerAuthStore.registerPoolCredential(
        provider,
        parseOptionalString(req.body?.label) ?? 'Credential',
        parseOptionalString(req.body?.email),
      )
      res.status(201).json({
        ...result,
        pool: await buildCredentialPoolRouteView(provider),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to register credential'
      res.status(400).json({ error: message })
    }
  })

  router.post('/provider-auth/pool/credentials/:provider/:credentialId/login-flow', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    const credentialId = parseOptionalString(req.params.credentialId)
    if (!provider || !credentialId) {
      res.status(400).json({ error: 'Invalid credential pool credential' })
      return
    }
    try {
      const flow = await startCredentialLoginFlow(provider, credentialId)
      res.status(201).json(serializeCredentialLoginFlow(flow))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start credential login flow'
      res.status(400).json({ error: message })
    }
  })

  router.get('/provider-auth/pool/credentials/:provider/:credentialId/login-flow/:flowId', requireReadAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    const credentialId = parseOptionalString(req.params.credentialId)
    const flowId = parseOptionalString(req.params.flowId)
    if (!provider || !credentialId || !flowId) {
      res.status(400).json({ error: 'Invalid credential login flow' })
      return
    }
    const flow = lookupCredentialLoginFlow(provider, credentialId, flowId)
    if (!flow) {
      res.status(404).json({ error: 'Credential login flow not found' })
      return
    }
    try {
      await refreshCredentialLoginFlow(flow)
      res.json(serializeCredentialLoginFlow(flow))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read credential login flow'
      res.status(400).json({ error: message })
    }
  })

  router.post('/provider-auth/pool/credentials/:provider/:credentialId/login-flow/:flowId/finalize', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    const credentialId = parseOptionalString(req.params.credentialId)
    const flowId = parseOptionalString(req.params.flowId)
    if (!provider || !credentialId || !flowId) {
      res.status(400).json({ error: 'Invalid credential login flow' })
      return
    }
    const flow = lookupCredentialLoginFlow(provider, credentialId, flowId)
    if (!flow) {
      res.status(404).json({ error: 'Credential login flow not found' })
      return
    }
    try {
      await refreshCredentialLoginFlow(flow, { waitForMint: true, retryMint: true })
      res.json(serializeCredentialLoginFlow(flow))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to finalize credential login flow'
      res.status(400).json({ error: message })
    }
  })

  router.post('/provider-auth/pool/switch', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.body?.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid credential pool provider' })
      return
    }
    try {
      const requestedExhaustedId = parseOptionalString(req.body?.exhaustedId)
      const sessionName = parseOptionalString(req.body?.sessionName)
      const sessionContext = await resolvePoolSwitchSessionContext(sessionName, provider)
      const exhaustedId = sessionContext.credentialPoolId ?? requestedExhaustedId
      const result = await providerAuthStore.switchToNextPoolCredential(
        provider,
        exhaustedId,
        {
          ...(sessionContext.host ? { host: sessionContext.host } : {}),
        },
      )
      const exhaustedCredential = exhaustedId && result.previousCredential?.id !== exhaustedId
        ? await providerAuthStore.getPoolCredential(provider, exhaustedId)
        : null
      const responseResult = exhaustedCredential
        ? { ...result, previousCredential: exhaustedCredential }
        : result
      const recovery = await queueCredentialRecovery(
        sessionName,
        provider,
        exhaustedId,
        result,
      )
      res.json({
        ...responseResult,
        pool: await buildCredentialPoolRouteView(provider),
        ...(recovery ? { recovery } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch credential'
      res.status(400).json({ error: message })
    }
  })

  router.delete('/provider-auth/pool/credentials/:provider/:credentialId', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    const credentialId = parseOptionalString(req.params.credentialId)
    if (!provider || !credentialId) {
      res.status(400).json({ error: 'Invalid credential pool credential' })
      return
    }
    try {
      stopCredentialLoginFlowsForCredential(provider, credentialId)
      await providerAuthStore.removePoolCredential(provider, credentialId)
      res.json(await buildCredentialPoolRouteView(provider))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove credential'
      res.status(400).json({ error: message })
    }
  })

  router.get('/provider-auth/:provider/reauth', requireWriteAccess, async (req, res) => {
    const provider = parseProviderId(req.params.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid provider' })
      return
    }
    const scopeId = typeof req.query.scopeId === 'string' && req.query.scopeId.trim().length > 0
      ? req.query.scopeId.trim()
      : resolveProviderAuthScopeId(humanCreatorId(sessionCreatorIdFromUser, req))
    const host = typeof req.query.host === 'string' && req.query.host.trim().length > 0
      ? req.query.host.trim()
      : 'local'
    try {
      const flow = await startReauthFlowForRequest(req, provider, scopeId, host)
      res.redirect(flow.authorizationUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start provider OAuth flow'
      res.status(400).json({ error: message })
    }
  })

  router.post('/provider-auth/:provider/reauth/start', requireWriteAccess, async (req, res) => {
    const provider = parseProviderId(req.params.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid provider' })
      return
    }
    const scopeId = typeof req.body?.scopeId === 'string' && req.body.scopeId.trim().length > 0
      ? req.body.scopeId.trim()
      : resolveProviderAuthScopeId(humanCreatorId(sessionCreatorIdFromUser, req))
    const host = typeof req.body?.host === 'string' && req.body.host.trim().length > 0
      ? req.body.host.trim()
      : 'local'
    try {
      res.json(await startReauthFlowForRequest(req, provider, scopeId, host))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start provider OAuth flow'
      res.status(400).json({ error: message })
    }
  })

  router.get('/provider-auth/oauth/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : ''
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : ''
    if (!state || !code) {
      sendProviderOAuthCallbackHtml(res, 400, 'Re-auth failed', 'OAuth callback requires state and code.')
      return
    }
    try {
      const result = await completeProviderOAuthFlow({
        state,
        code,
        store: providerAuthStore,
      })
      await handleProviderAuthCompleted(result)
      sendProviderOAuthCallbackHtml(
        res,
        200,
        'Re-auth complete',
        'Provider authentication is ready. You can close this tab and return to Herd.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to complete provider OAuth flow'
      sendProviderOAuthCallbackHtml(res, 400, 'Re-auth failed', message)
    }
  })

  return {
    markProviderAuthRequired,
    refreshProviderAuthSnapshots,
  }
}
