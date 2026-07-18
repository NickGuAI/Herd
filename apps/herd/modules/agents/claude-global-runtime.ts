import {
  ClaudeCredentialCoordinator,
  DEFAULT_CLAUDE_QUOTA_POLL_INTERVAL_MS,
  type ClaudeGlobalActivationHookInput,
  type ClaudeQuotaReader,
  type ClaudeQuotaRefreshResult,
} from './claude-credential-coordinator.js'
import {
  ClaudeForeignGlobalLoginError,
  ClaudeGlobalAuthValidationError,
  ClaudeGlobalCredentialStateError,
  HERD_CLAUDE_GLOBAL_CONFIG_DIR,
  resolveClaudeAccountIdFromProfile,
  validateClaudeGlobalAuthWithCli,
  type ClaudeAccountIdentityResolver,
  type ClaudeGlobalAuthValidator,
  type CredentialPoolSwitchResult,
  type ProviderAuthStore,
} from './provider-auth.js'
import type { ProviderSessionRuntime } from './session/provider-runtime.js'
import type { SessionAutoRotationRuntime } from './session/auto-rotation.js'
import type {
  AnySession,
  CredentialPoolRecoveryRequest,
  StreamSession,
} from './types.js'

interface ClaudeGlobalRuntimeOptions {
  providerAuthStore: ProviderAuthStore
  quotaReader?: ClaudeQuotaReader | undefined
  globalConfigDir?: string | undefined
  quotaPollIntervalMs?: number | undefined
  resolveAccountId?: ClaudeAccountIdentityResolver | undefined
  validateGlobalAuth?: ClaudeGlobalAuthValidator | undefined
  sessions: Map<string, AnySession>
  credentialRecoveryRequests: Map<string, CredentialPoolRecoveryRequest>
  getProviderRuntime(): ProviderSessionRuntime
  getAutoRotationRuntime(): SessionAutoRotationRuntime
  schedulePersistedSessionsWrite(): void
}

interface QueueReloadOptions {
  reason: CredentialPoolRecoveryRequest['reason']
  excludeSessionName?: string
  forceReload?: boolean
  blockedOnly?: boolean
  includeSessionNames?: ReadonlySet<string>
}

type ClaudeReactiveActivationHookInput = ClaudeGlobalActivationHookInput & {
  reason: 'auth_required' | 'usage_limit'
}

export interface ClaudeGlobalRuntime {
  quotaPollIntervalMs: number
  awaitCredentialReady(): Promise<void>
  acquireCredentialLease(): Promise<() => void>
  initializeBeforeRestore(): Promise<void>
  activateCredential(
    credentialId: string,
    options?: { sourceAuthoritative?: boolean; forceReload?: boolean },
  ): Promise<CredentialPoolSwitchResult>
  refreshQuota(credentialId?: string, force?: boolean): Promise<ClaudeQuotaRefreshResult>
  recoverUsageLimit(
    session: StreamSession,
    options: { resetAt?: string },
  ): Promise<CredentialPoolSwitchResult>
  recoverAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<CredentialPoolSwitchResult | null>
  getQuotaSnapshot: ClaudeCredentialCoordinator['getQuotaSnapshot']
  getActiveCredentialId: ClaudeCredentialCoordinator['getGlobalActiveCredentialId']
  shutdown(): void
}

function isLocalClaudeSession(session: AnySession): session is StreamSession {
  return session.kind === 'stream'
    && session.agentType === 'claude'
    && (session.host ?? 'local') === 'local'
    && session.credentialPoolMode !== 'isolated-runtime'
}

export function createClaudeGlobalRuntime(
  options: ClaudeGlobalRuntimeOptions,
): ClaudeGlobalRuntime {
  const env = options.globalConfigDir
    ? {
        ...process.env,
        [HERD_CLAUDE_GLOBAL_CONFIG_DIR]: options.globalConfigDir,
      }
    : process.env
  const quotaPollIntervalMs = Math.max(
    0,
    options.quotaPollIntervalMs ?? DEFAULT_CLAUDE_QUOTA_POLL_INTERVAL_MS,
  )
  let activationGate: Promise<void> | null = null
  let releaseActivationGate: (() => void) | null = null
  let fatalCredentialStateError: Error | null = null
  let stoppedForPendingActivation = new Set<string>()
  let affectedForPendingActivation = new Map<string, {
    recovery?: CredentialPoolRecoveryRequest
    autoRotatePending: boolean
  }>()
  let activeCredentialLeases = 0
  const credentialLeaseWaiters = new Set<() => void>()
  let resetWakeTimer: NodeJS.Timeout | null = null
  let reactiveActivationRetryScheduled = false
  let reactiveActivationRetryTimer: NodeJS.Timeout | null = null
  let reactiveActivationRetryRequested = false
  let reactiveActivationRetryInput: ClaudeReactiveActivationHookInput | undefined
  const reactiveActivationFailedCredentialIds = new Set<string>()

  function localSessions(): StreamSession[] {
    return [...options.sessions.values()].filter(isLocalClaudeSession)
  }

  function finishActivation(): void {
    const release = releaseActivationGate
    releaseActivationGate = null
    activationGate = null
    release?.()
  }

  function scheduleReactiveActivationRetry(input: ClaudeReactiveActivationHookInput): void {
    reactiveActivationRetryInput = input
    reactiveActivationFailedCredentialIds.add(input.targetCredentialId)
    if (reactiveActivationRetryScheduled) {
      reactiveActivationRetryRequested = true
      return
    }
    reactiveActivationRetryScheduled = true
    reactiveActivationRetryTimer = setTimeout(() => {
      reactiveActivationRetryTimer = null
      const retryInput = reactiveActivationRetryInput
      if (!retryInput) {
        reactiveActivationRetryScheduled = false
        return
      }
      void coordinator.retryReactiveActivation({
        reason: retryInput.reason,
        excludedCredentialIds: new Set(reactiveActivationFailedCredentialIds),
        ...(retryInput.triggerSessionName
          ? { triggerSessionName: retryInput.triggerSessionName }
          : {}),
      })
        .then((result) => {
          if (!result.activeCredential || result.blocked) {
            return
          }
          queueSessionReloads(result, {
            reason: retryInput.reason,
            forceReload: true,
          })
        })
        .catch((error) => {
          console.warn('[agents/provider-auth] reactive Claude activation retry failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          finishActivation()
          reactiveActivationRetryScheduled = false
          if (reactiveActivationRetryRequested && reactiveActivationRetryInput) {
            reactiveActivationRetryRequested = false
            scheduleReactiveActivationRetry(reactiveActivationRetryInput)
            return
          }
          reactiveActivationRetryInput = undefined
          reactiveActivationFailedCredentialIds.clear()
        })
    }, 0)
    reactiveActivationRetryTimer.unref?.()
  }

  async function waitForSafeBoundaries(sessionNames: ReadonlySet<string>): Promise<void> {
    while ([...sessionNames].some((sessionName) => {
      const session = options.sessions.get(sessionName)
      return session?.kind === 'stream'
        && !(session.restoredIdle && session.credentialPoolRecovery)
        && (!session.lastTurnCompleted || Boolean(session.currentQueuedMessage))
    })) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  }

  async function beforeActivation(input: ClaudeGlobalActivationHookInput): Promise<void> {
    if (activationGate) {
      throw new Error('A global Claude credential activation is already pending')
    }
    activationGate = new Promise<void>((resolve) => {
      releaseActivationGate = resolve
    })
    if (activeCredentialLeases > 0) {
      await new Promise<void>((resolve) => credentialLeaseWaiters.add(resolve))
    }
    const affected = localSessions()
    stoppedForPendingActivation = new Set()
    affectedForPendingActivation = new Map(affected.map((session) => [session.name, {
      ...(session.credentialPoolRecovery
        ? { recovery: { ...session.credentialPoolRecovery } }
        : {}),
      autoRotatePending: session.autoRotatePending,
    }]))
    const affectedNames = new Set(affected
      .filter((session) => session.name !== input.triggerSessionName)
      .map((session) => session.name))
    for (const session of affected) {
      const existing = session.credentialPoolRecovery
      const recoveryReason = (input.reason === 'usage_limit' || input.reason === 'auth_required')
        && session.name !== input.triggerSessionName
        ? 'quota_threshold'
        : input.reason
      const request: CredentialPoolRecoveryRequest = existing
        ? {
            ...existing,
            state: 'awaiting_safe_boundary',
            previousCredentialPoolId: existing.previousCredentialPoolId
              ?? session.credentialPoolId
              ?? input.previousCredentialId,
            clearResumeProviderContext: false,
          }
        : {
            provider: 'claude',
            state: 'awaiting_safe_boundary',
            previousCredentialPoolId: session.credentialPoolId
              ?? input.previousCredentialId,
            clearResumeProviderContext: false,
            reason: recoveryReason,
            requestedAt: new Date().toISOString(),
          }
      delete request.credentialPoolId
      delete request.failureCode
      delete request.failureReason
      session.credentialPoolRecovery = request
      options.credentialRecoveryRequests.set(session.name, request)
    }
    if (affected.length > 0) {
      options.schedulePersistedSessionsWrite()
    }
    await waitForSafeBoundaries(affectedNames)
    for (const session of affected) {
      if (session.credentialPoolRecovery) {
        session.credentialPoolRecovery.state = 'stopping_old_runtime'
      }
    }
    if (affected.length > 0) {
      options.schedulePersistedSessionsWrite()
    }
    const teardownResults = await Promise.allSettled(affected.map(async (session) => {
      const stopResult = await options.getProviderRuntime().teardownProviderSession(
        session,
        `Preparing global Claude credential switch to "${input.targetCredentialId}"`,
        { preserveForReplacement: true },
      )
      if (stopResult && !stopResult.verified) {
        throw new Error(`Provider runtime stop was not verified for session "${session.name}"`)
      }
      if (stopResult) {
        console.info('[agents/provider-auth] verified provider runtime stop before credential activation', {
          session: session.name,
          provider: session.agentType,
          host: session.host ?? 'local',
          targetCredentialId: input.targetCredentialId,
          ...stopResult,
        })
      }
      stoppedForPendingActivation.add(session.name)
    }))
    const failed = teardownResults.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') {
      throw failed.reason
    }
    for (const session of affected) {
      if (session.credentialPoolRecovery) {
        session.credentialPoolRecovery.state = 'activating_credential'
      }
    }
    if (affected.length > 0) {
      options.schedulePersistedSessionsWrite()
    }
  }

  function queueSessionReloads(
    result: CredentialPoolSwitchResult,
    reloadOptions: QueueReloadOptions,
  ): number {
    const activeCredentialId = result.activeCredential?.id
    if (!activeCredentialId) {
      return 0
    }
    let queued = 0
    for (const session of options.sessions.values()) {
      if (
        !isLocalClaudeSession(session)
        || (reloadOptions.includeSessionNames && !reloadOptions.includeSessionNames.has(session.name))
        || session.name === reloadOptions.excludeSessionName
        || (reloadOptions.blockedOnly && !session.credentialPoolRecovery)
        || (!reloadOptions.forceReload && session.credentialPoolId === activeCredentialId)
      ) {
        continue
      }
      const existing = session.credentialPoolRecovery
      const request: CredentialPoolRecoveryRequest = existing
        ? {
            ...existing,
            state: 'reloading_session',
            credentialPoolId: activeCredentialId,
            previousCredentialPoolId: existing.previousCredentialPoolId
              ?? session.credentialPoolId
              ?? result.previousCredential?.id,
            clearResumeProviderContext: false,
          }
        : {
            provider: 'claude',
            state: 'reloading_session',
            credentialPoolId: activeCredentialId,
            previousCredentialPoolId: session.credentialPoolId
              ?? result.previousCredential?.id,
            clearResumeProviderContext: false,
            reason: reloadOptions.reason,
            requestedAt: new Date().toISOString(),
          }
      session.credentialPoolRecovery = request
      delete request.failureCode
      delete request.failureReason
      session.autoRotatePending = true
      options.credentialRecoveryRequests.set(session.name, request)
      options.getAutoRotationRuntime().scheduleAutoRotationIfNeeded(session.name)
      queued += 1
    }
    if (queued > 0) {
      options.schedulePersistedSessionsWrite()
    }
    return queued
  }

  async function activationFailed(input: ClaudeGlobalActivationHookInput, error: unknown): Promise<void> {
    const fatalCredentialError = error instanceof ClaudeGlobalCredentialStateError
      ? error
      : null
    if (fatalCredentialError) {
      fatalCredentialStateError = fatalCredentialError
    }
    for (const [sessionName, previous] of affectedForPendingActivation) {
      if (stoppedForPendingActivation.has(sessionName)) {
        continue
      }
      const session = options.sessions.get(sessionName)
      if (!session || session.kind !== 'stream') {
        continue
      }
      session.credentialPoolRecovery = previous.recovery
        ? { ...previous.recovery }
        : undefined
      session.autoRotatePending = previous.autoRotatePending
      if (previous.recovery) {
        options.credentialRecoveryRequests.set(sessionName, previous.recovery)
      } else {
        options.credentialRecoveryRequests.delete(sessionName)
      }
    }
    if (fatalCredentialError) {
      for (const sessionName of stoppedForPendingActivation) {
        const session = options.sessions.get(sessionName)
        if (!session || session.kind !== 'stream' || !session.credentialPoolRecovery) {
          continue
        }
        delete session.credentialPoolRecovery.credentialPoolId
        session.credentialPoolRecovery.state = 'blocked'
        session.credentialPoolRecovery.failureCode = 'credential_state_unrecoverable'
        session.credentialPoolRecovery.failureReason = fatalCredentialError.message
        session.autoRotatePending = false
        options.credentialRecoveryRequests.set(sessionName, session.credentialPoolRecovery)
      }
      options.schedulePersistedSessionsWrite()
      return
    }
    let pool = await options.providerAuthStore.listPoolCredentials('claude')
    let activeCredential = pool.credentials.find((credential) => credential.id === pool.active)
    if (!activeCredential) {
      return
    }
    if (input.reason === 'quota_threshold') {
      // A proactive quota switch can fail after the old process fleet has
      // already stopped. The previous global login is still installed, so
      // make it spawnable again long enough to resume those sessions.
      await options.providerAuthStore.reconcilePoolCredentialExhaustion(
        'claude',
        activeCredential.id,
        null,
      )
      pool = await options.providerAuthStore.listPoolCredentials('claude')
      activeCredential = pool.credentials.find((credential) => credential.id === pool.active)
      if (!activeCredential) {
        return
      }
    }
    if (input.reason === 'usage_limit' || input.reason === 'auth_required') {
      for (const sessionName of stoppedForPendingActivation) {
        const session = options.sessions.get(sessionName)
        if (!session || session.kind !== 'stream' || !session.credentialPoolRecovery) {
          continue
        }
        delete session.credentialPoolRecovery.credentialPoolId
        session.credentialPoolRecovery.state = 'retry_scheduled'
        session.autoRotatePending = false
        options.credentialRecoveryRequests.set(sessionName, session.credentialPoolRecovery)
      }
      options.schedulePersistedSessionsWrite()
      scheduleReactiveActivationRetry({ ...input, reason: input.reason })
      return
    }
    queueSessionReloads({
      provider: 'claude',
      switched: false,
      ...(input.previousCredentialId ? {
        previousCredential: pool.credentials.find((credential) => (
          credential.id === input.previousCredentialId
        )),
      } : {}),
      activeCredential,
      pool,
    }, {
      reason: input.reason,
      forceReload: true,
      includeSessionNames: stoppedForPendingActivation,
    })
    options.schedulePersistedSessionsWrite()
  }

  const resolveAccountId = options.resolveAccountId ?? resolveClaudeAccountIdFromProfile
  const validateGlobalAuth = options.validateGlobalAuth ?? validateClaudeGlobalAuthWithCli

  const coordinator = new ClaudeCredentialCoordinator({
    providerAuthStore: options.providerAuthStore,
    ...(options.quotaReader ? { quotaReader: options.quotaReader } : {}),
    env,
    beforeActivation,
    activationFailed,
    resolveAccountId,
    validateGlobalAuth,
  })
  const initializationReady = options.providerAuthStore.reconcileGlobalClaudeCredential({
    env,
    resolveAccountId,
    validateGlobalAuth,
  })
    .catch((error) => {
      if (error instanceof ClaudeGlobalAuthValidationError) {
        console.warn('[agents/provider-auth] configured global Claude credential requires recovery', {
          error: error.message,
        })
        return null
      }
      if (error instanceof ClaudeForeignGlobalLoginError) {
        console.warn('[agents/provider-auth] global Claude login is foreign to the pool; awaiting an explicit credential switch', {
          error: error.message,
        })
        return null
      }
      console.warn('[agents/provider-auth] failed to reconcile global Claude credential', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })

  async function activateCredential(
    credentialId: string,
    activationOptions: { sourceAuthoritative?: boolean; forceReload?: boolean } = {},
  ): Promise<CredentialPoolSwitchResult> {
    try {
      const result = await coordinator.activateCredential(credentialId, {
        ...(activationOptions.sourceAuthoritative
          ? { sourceAuthoritative: true, allowExhausted: true }
          : { replaceForeignGlobal: true }),
        reason: activationOptions.sourceAuthoritative ? 'auth_required' : 'manual_switch',
      })
      if (result.switched || activationOptions.forceReload) {
        queueSessionReloads(result, { reason: 'manual_switch', forceReload: true })
      }
      return result
    } finally {
      finishActivation()
    }
  }

  async function refreshQuota(
    credentialId?: string,
    force = false,
  ): Promise<ClaudeQuotaRefreshResult> {
    try {
      const refreshed = await coordinator.refreshQuota({
        ...(credentialId ? { credentialId } : {}),
        force,
      })
      scheduleResetWake(refreshed)
      if (refreshed.activation) {
        queueSessionReloads(refreshed.activation, {
          reason: 'quota_threshold',
          forceReload: true,
        })
      } else if (refreshed.reloadActive && refreshed.pool.active) {
        const activeCredential = refreshed.pool.credentials.find((credential) => (
          credential.id === refreshed.pool.active
        ))
        if (activeCredential) {
          queueSessionReloads({
            provider: 'claude',
            switched: false,
            activeCredential,
            pool: refreshed.pool,
          }, {
            reason: 'quota_threshold',
            forceReload: true,
            blockedOnly: true,
          })
        }
      }
      return refreshed
    } finally {
      finishActivation()
    }
  }

  function scheduleResetWake(refreshed: ClaudeQuotaRefreshResult): void {
    if (resetWakeTimer) {
      clearTimeout(resetWakeTimer)
      resetWakeTimer = null
    }
    const now = Date.now()
    const resetTimes = [
      refreshed.pool.earliestExhaustedUntil,
      ...Object.values(refreshed.snapshots).flatMap((snapshot) => (
        snapshot.fetchStatus === 'fresh'
          ? snapshot.windows.map((window) => window.resetsAt)
          : []
      )),
    ]
      .map((value) => value ? Date.parse(value) : Number.NaN)
      .filter((value) => Number.isFinite(value) && value > now)
    if (resetTimes.length === 0) {
      return
    }
    const delay = Math.min(Math.min(...resetTimes) - now + 250, 2_147_483_647)
    resetWakeTimer = setTimeout(() => {
      resetWakeTimer = null
      void refreshQuota(undefined, true).catch((error) => {
        console.warn('[agents/provider-auth] Claude quota reset refresh failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, delay)
    resetWakeTimer.unref?.()
  }

  async function recoverUsageLimit(
    session: StreamSession,
    usageOptions: { resetAt?: string },
  ): Promise<CredentialPoolSwitchResult> {
    if (
      session.agentType !== 'claude'
      || (session.host ?? 'local') !== 'local'
      || session.credentialPoolMode === 'isolated-runtime'
    ) {
      return options.providerAuthStore.switchToNextPoolCredential(
        session.agentType,
        session.credentialPoolId,
        {
          resetAt: usageOptions.resetAt,
          host: session.host,
          ...(session.agentType === 'claude'
            && (session.host ?? 'local') === 'local'
            && session.credentialPoolMode === 'isolated-runtime'
            ? { preserveActive: true }
            : {}),
        },
      )
    }
    try {
      const result = await coordinator.recoverUsageLimit({
        failedCredentialId: session.credentialPoolId,
        ...(usageOptions.resetAt ? { resetAt: usageOptions.resetAt } : {}),
        triggerSessionName: session.name,
      })
      if (result.switched) {
        queueSessionReloads(result, {
          reason: 'quota_threshold',
          excludeSessionName: session.name,
          forceReload: true,
        })
      }
      return result
    } finally {
      finishActivation()
    }
  }

  async function recoverAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<CredentialPoolSwitchResult | null> {
    if (
      session.agentType !== 'claude'
      || (session.host ?? 'local') !== 'local'
      || session.credentialPoolMode === 'isolated-runtime'
    ) {
      return null
    }
    try {
      const result = await coordinator.recoverAuthRequired({
        failedCredentialId: session.credentialPoolId,
        triggerSessionName: session.name,
        detail,
      })
      if (result.activeCredential && !result.blocked) {
        queueSessionReloads(result, {
          reason: result.switched ? 'quota_threshold' : 'auth_required',
          forceReload: true,
          ...(result.switched ? {} : { includeSessionNames: new Set([session.name]) }),
        })
      }
      return result
    } finally {
      finishActivation()
    }
  }

  async function initializeBeforeRestore(): Promise<void> {
    await initializationReady
    await refreshQuota().catch((error) => {
      console.warn('[agents/provider-auth] initial Claude quota refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  let pollingStopped = false
  let pollInFlight = false
  const pollTimer = quotaPollIntervalMs > 0
    ? setInterval(() => {
        if (pollingStopped || pollInFlight) {
          return
        }
        pollInFlight = true
        void refreshQuota()
          .catch((error) => {
            console.warn('[agents/provider-auth] Claude quota refresh failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => {
            pollInFlight = false
          })
      }, quotaPollIntervalMs)
    : null
  pollTimer?.unref?.()

  function shutdown(): void {
    pollingStopped = true
    if (pollTimer) {
      clearInterval(pollTimer)
      process.off('SIGTERM', shutdown)
    }
    if (resetWakeTimer) {
      clearTimeout(resetWakeTimer)
      resetWakeTimer = null
    }
    if (reactiveActivationRetryTimer) {
      clearTimeout(reactiveActivationRetryTimer)
      reactiveActivationRetryTimer = null
      reactiveActivationRetryScheduled = false
    }
    reactiveActivationRetryRequested = false
    reactiveActivationRetryInput = undefined
    reactiveActivationFailedCredentialIds.clear()
  }

  async function acquireCredentialLease(): Promise<() => void> {
    await initializationReady
    while (true) {
      if (fatalCredentialStateError) {
        throw fatalCredentialStateError
      }
      const pendingActivation = activationGate
      if (pendingActivation) {
        await pendingActivation
        continue
      }
      activeCredentialLeases += 1
      let released = false
      return () => {
        if (released) {
          return
        }
        released = true
        activeCredentialLeases -= 1
        if (activeCredentialLeases === 0) {
          for (const resolve of credentialLeaseWaiters) {
            resolve()
          }
          credentialLeaseWaiters.clear()
        }
      }
    }
  }
  if (pollTimer) {
    process.on('SIGTERM', shutdown)
  }

  return {
    quotaPollIntervalMs,
    awaitCredentialReady: async () => {
      if (fatalCredentialStateError) {
        throw fatalCredentialStateError
      }
      await initializationReady
      await (activationGate ?? Promise.resolve())
      if (fatalCredentialStateError) {
        throw fatalCredentialStateError
      }
    },
    acquireCredentialLease,
    initializeBeforeRestore,
    activateCredential,
    refreshQuota,
    recoverUsageLimit,
    recoverAuthRequired,
    getQuotaSnapshot: (credentialId) => coordinator.getQuotaSnapshot(credentialId),
    getActiveCredentialId: () => coordinator.getGlobalActiveCredentialId(),
    shutdown,
  }
}
