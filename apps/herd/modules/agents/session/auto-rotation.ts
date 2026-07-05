import { getProvider } from '../providers/registry.js'
import { SessionMessageQueue, type QueuedMessage } from '../message-queue.js'
import { getNextStreamEventSeq } from '../messages/canonical-timeline.js'
import type { ProviderCreateOptions, ProviderTeardownOptions } from '../providers/provider-adapter.js'
import type { ProviderAuthStore } from '../provider-auth.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CredentialPoolRecoveryRequest,
  MachineConfig,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

type ProviderStreamSessionOptions = Omit<
  ProviderCreateOptions,
  'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'
>

interface SessionAutoRotationQueueRuntime {
  clearQueuedMessageRetry(session: StreamSession): void
  getQueuedBacklogCount(session: StreamSession): number
  scheduleQueuedMessageDrain(session: StreamSession, options?: { force?: boolean }): void
}

interface SessionAutoRotationRuntimeDeps {
  sessions: Map<string, AnySession>
  providerAuthStore: ProviderAuthStore
  autoRotateEntryThreshold: number
  buildCommanderReplacementPrompt?(
    session: StreamSession,
  ): Promise<{ systemPrompt?: string; maxTurns?: number }>
  readMachineRegistry(): Promise<MachineConfig[]>
  createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: StreamSession['agentType'],
    options?: ProviderStreamSessionOptions,
  ): Promise<StreamSession>
  teardownProviderSession(session: StreamSession, reason: string, options?: ProviderTeardownOptions): Promise<void>
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  schedulePersistedSessionsWrite(): void
  markCredentialRecoveryRequest?(sessionName: string, request: CredentialPoolRecoveryRequest): void
  clearCredentialRecoveryRequest?(sessionName: string): void
  getQueueRuntime(): SessionAutoRotationQueueRuntime
}

export interface SessionAutoRotationRuntime {
  supportsAutoRotation(session: StreamSession): boolean
  initializeAutoRotationState(session: StreamSession): void
  scheduleAutoRotationIfNeeded(sessionName: string): void
  awaitAutoRotationIfNeeded(sessionName: string): Promise<StreamSession | null>
}

export function createSessionAutoRotationRuntime(
  deps: SessionAutoRotationRuntimeDeps,
): SessionAutoRotationRuntime {
  const autoRotationQueues = new Map<string, Promise<StreamSession | null>>()

  function supportsAutoRotation(session: StreamSession): boolean {
    if (session.sessionType === 'cron' || session.sessionType === 'automation') {
      return false
    }
    const provider = getProvider(session.agentType)
    return Boolean(
      provider?.uiCapabilities.supportsEffort
      || provider?.runtimeWatchdog,
    )
  }

  function initializeAutoRotationState(session: StreamSession): void {
    session.autoRotatePending = supportsAutoRotation(session)
      && session.conversationEntryCount >= deps.autoRotateEntryThreshold
    if (session.autoRotatePending) {
      scheduleAutoRotationIfNeeded(session.name)
    }
  }

  function createAutoRotationEvent(
    session: StreamSession,
    fromBackingId: string | undefined,
    toBackingId: string | undefined,
  ): StreamJsonEvent {
    const backingLabel = getProvider(session.agentType)?.runtimeWatchdog
      ? 'thread'
      : 'session'
    return {
      type: 'system',
      subtype: 'session_rotated',
      reason: 'auto-entry-threshold',
      entryCount: session.conversationEntryCount,
      threshold: deps.autoRotateEntryThreshold,
      fromBackingId: fromBackingId ?? null,
      toBackingId: toBackingId ?? null,
      text: `Session auto-rotated after ${session.conversationEntryCount} entries (${backingLabel}: ${fromBackingId ?? 'unknown'} -> ${toBackingId ?? 'pending'}).`,
    }
  }

  async function resolveSessionMachine(session: StreamSession): Promise<MachineConfig | undefined> {
    if (!session.host) {
      return undefined
    }
    const machines = await deps.readMachineRegistry()
    const machine = machines.find((candidate) => candidate.id === session.host)
    if (!machine) {
      throw new Error(`Host machine "${session.host}" is unavailable for session rotation`)
    }
    return machine
  }

  async function buildReplacementPromptOptions(
    session: StreamSession,
  ): Promise<{ systemPrompt?: string; maxTurns?: number }> {
    if (session.sessionType === 'commander' && session.creator.kind === 'commander') {
      try {
        const seeded = await deps.buildCommanderReplacementPrompt?.(session)
        if (seeded) {
          return seeded
        }
      } catch {
        // Fall back to the current session prompt when commander-owned seeding is unavailable.
      }
    }

    return {
      systemPrompt: session.systemPrompt,
      maxTurns: session.maxTurns,
    }
  }

  async function createReplacementStreamSession(
    sessionName: string,
    session: StreamSession,
  ): Promise<StreamSession> {
    const machine = await resolveSessionMachine(session)
    const promptOptions = await buildReplacementPromptOptions(session)
    const credentialRecovery = session.credentialPoolRecovery
    return deps.createProviderStreamSession(
      sessionName,
      session.mode,
      '',
      session.cwd,
      machine,
      session.agentType,
      {
        effort: session.effort,
        adaptiveThinking: session.adaptiveThinking,
        maxThinkingTokens: session.maxThinkingTokens,
        model: session.model,
        createdAt: session.createdAt,
        spawnedBy: session.spawnedBy,
        spawnedWorkers: session.spawnedWorkers,
        resumedFrom: session.resumedFrom,
        sessionType: session.sessionType,
        creator: session.creator,
        conversationId: session.conversationId,
        currentSkillInvocation: session.currentSkillInvocation,
        systemPrompt: promptOptions.systemPrompt,
        maxTurns: promptOptions.maxTurns,
        ...(credentialRecovery?.clearResumeProviderContext ? { resumeProviderContext: undefined } : {}),
        ...(credentialRecovery?.credentialPoolId ? { credentialPoolId: credentialRecovery.credentialPoolId } : {}),
      },
    )
  }

  function createCredentialRecoveryContinuationMessage(session: StreamSession): QueuedMessage {
    const request = session.credentialPoolRecovery
    const now = new Date().toISOString()
    const suffix = Math.random().toString(36).slice(2, 8)
    const turnText = request?.interruptedTurnId
      ? ` turn ${request.interruptedTurnId}`
      : ' the interrupted turn'
    return {
      id: `credential-recovery-${Date.now()}-${suffix}`,
      text: `Continue${turnText} after automatic credential-pool rotation. The previous provider credential hit a usage limit after side-effect events were emitted. Use the transcript and available Herd CLI context to continue without re-running completed external actions.`,
      clientSendId: `credential-recovery-${Date.now()}-${suffix}`,
      priority: 'high',
      queuedAt: now,
    }
  }

  function recoveryMessagesForReplacement(session: StreamSession): StreamSession['pendingDirectSendMessages'] {
    const request = session.credentialPoolRecovery
    if (!request?.interruptedMessage) {
      return []
    }
    if (request.interruptedTurnHadSideEffects) {
      return [createCredentialRecoveryContinuationMessage(session)]
    }
    return [request.interruptedMessage]
  }

  async function refreshBlockedCredentialRecovery(session: StreamSession): Promise<void> {
    const recovery = session.credentialPoolRecovery
    if (!recovery || recovery.credentialPoolId) {
      return
    }

    const pool = await deps.providerAuthStore.listPoolCredentials(session.agentType)
    const ready = pool.credentials.find((credential) => (
      credential.id === pool.active
      && !credential.exhausted
      && credential.status !== 'auth_required'
    )) ?? pool.credentials.find((credential) => (
      !credential.exhausted
      && credential.status !== 'auth_required'
    ))

    if (!ready) {
      const blockedUntil = pool.earliestExhaustedUntil
      if (blockedUntil && blockedUntil !== recovery.blockedUntil) {
        session.credentialPoolRecovery = {
          ...recovery,
          blockedUntil,
        }
        deps.markCredentialRecoveryRequest?.(session.name, session.credentialPoolRecovery)
        deps.schedulePersistedSessionsWrite()
      }
      return
    }

    const request: CredentialPoolRecoveryRequest = {
      ...recovery,
      credentialPoolId: ready.id,
      previousCredentialPoolId: session.credentialPoolId,
      clearResumeProviderContext: true,
      requestedAt: new Date().toISOString(),
    }
    delete request.blockedUntil
    session.credentialPoolRecovery = request
    deps.markCredentialRecoveryRequest?.(session.name, request)
    deps.schedulePersistedSessionsWrite()
  }

  async function rotateStreamSessionIfNeeded(sessionName: string): Promise<StreamSession | null> {
    const current = deps.sessions.get(sessionName)
    if (!current || current.kind !== 'stream') {
      return null
    }
    if (current.credentialPoolRecovery && !current.credentialPoolRecovery.credentialPoolId) {
      await refreshBlockedCredentialRecovery(current)
    }
    const credentialRecovery = current.credentialPoolRecovery
    if (credentialRecovery && !credentialRecovery.credentialPoolId) {
      return current
    }
    if (!current.autoRotatePending && !credentialRecovery) {
      return current
    }
    if (!supportsAutoRotation(current)) {
      current.autoRotatePending = false
      return current
    }
    if (!current.lastTurnCompleted || (!credentialRecovery && current.currentQueuedMessage)) {
      return current
    }

    try {
      const queueRuntime = deps.getQueueRuntime()
      const rotated = await createReplacementStreamSession(sessionName, current)
      const rotatedPreludeEvents = rotated.events.slice()
      const fromBackingId = getProvider(current.agentType)?.getResumeId(current)
      const toBackingId = getProvider(rotated.agentType)?.getResumeId(rotated)
      const rotationEvent = createAutoRotationEvent(current, fromBackingId, toBackingId)

      if (!credentialRecovery) {
        deps.appendStreamEvent(current, rotationEvent)
        deps.broadcastStreamEvent(current, rotationEvent)
      }

      queueRuntime.clearQueuedMessageRetry(current)
      const recoveryMessages = recoveryMessagesForReplacement(current)
      const recoveryMessageIds = new Set(recoveryMessages.map((message) => message.id))
      rotated.messageQueue = new SessionMessageQueue(current.messageQueue.maxSize, current.messageQueue.list())
      rotated.pendingDirectSendMessages = [
        ...recoveryMessages,
        ...current.pendingDirectSendMessages.filter((message) => !recoveryMessageIds.has(message.id)),
      ]
      rotated.events = [...current.events, ...rotatedPreludeEvents]
      rotated.nextEventSeq = getNextStreamEventSeq(rotated.events)
      rotated.usage = { ...current.usage }
      if (rotatedPreludeEvents.length === 0) {
        rotated.lastEventAt = current.lastEventAt
      }
      rotated.conversationEntryCount = credentialRecovery ? current.conversationEntryCount : 0
      rotated.autoRotatePending = false
      rotated.credentialPoolRecovery = undefined

      for (const client of current.clients) {
        rotated.clients.add(client)
      }
      current.clients.clear()

      deps.sessions.set(sessionName, rotated)

      void deps.teardownProviderSession(current, `Auto-rotated session "${sessionName}"`).catch(() => undefined)

      for (const preludeEvent of rotatedPreludeEvents) {
        deps.broadcastStreamEvent(rotated, preludeEvent)
      }

      deps.schedulePersistedSessionsWrite()
      deps.clearCredentialRecoveryRequest?.(sessionName)
      if (queueRuntime.getQueuedBacklogCount(rotated) > 0 && rotated.lastTurnCompleted && !rotated.currentQueuedMessage) {
        queueRuntime.scheduleQueuedMessageDrain(rotated, { force: true })
      }
      return rotated
    } catch (error) {
      const live = deps.sessions.get(sessionName)
      if (!live || live.kind !== 'stream') {
        return null
      }
      const message = error instanceof Error ? error.message : String(error)
      const failureEvent: StreamJsonEvent = {
        type: 'system',
        subtype: 'session_rotation_failed',
        reason: 'auto-entry-threshold',
        text: `Session auto-rotation failed: ${message}`,
      }
      deps.appendStreamEvent(live, failureEvent)
      deps.broadcastStreamEvent(live, failureEvent)
      deps.schedulePersistedSessionsWrite()
      return live
    }
  }

  function scheduleAutoRotationIfNeeded(sessionName: string): void {
    const existing = autoRotationQueues.get(sessionName)
    if (existing) {
      return
    }

    const task = rotateStreamSessionIfNeeded(sessionName)
      .catch(() => null)
      .finally(() => {
        if (autoRotationQueues.get(sessionName) === task) {
          autoRotationQueues.delete(sessionName)
        }
        const live = deps.sessions.get(sessionName)
        if (
          live &&
          live.kind === 'stream' &&
          live.autoRotatePending &&
          live.lastTurnCompleted &&
          !live.currentQueuedMessage &&
          !autoRotationQueues.has(sessionName)
        ) {
          scheduleAutoRotationIfNeeded(sessionName)
        }
      })

    autoRotationQueues.set(sessionName, task)
  }

  async function awaitAutoRotationIfNeeded(sessionName: string): Promise<StreamSession | null> {
    const existing = autoRotationQueues.get(sessionName)
    if (existing) {
      return existing
    }
    return rotateStreamSessionIfNeeded(sessionName)
  }

  return {
    supportsAutoRotation,
    initializeAutoRotationState,
    scheduleAutoRotationIfNeeded,
    awaitAutoRotationIfNeeded,
  }
}
