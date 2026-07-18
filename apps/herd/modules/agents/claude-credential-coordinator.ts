import {
  DEFAULT_CLAUDE_QUOTA_TTL_MS,
  ClaudeQuotaService,
  defaultClaudeQuotaCachePath,
  evaluateClaudeQuotaEligibility,
  type ClaudeQuotaSnapshot,
} from './claude-quota.js'
import {
  DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS,
  HERD_CLAUDE_GLOBAL_CONFIG_DIR,
  type ClaudeGlobalCredentialActivationOptions,
  type ClaudeAccountIdentityResolver,
  type ClaudeGlobalAuthValidator,
  type CredentialPoolCredentialView,
  type CredentialPoolSwitchResult,
  type CredentialPoolView,
  type ProviderAuthStore,
} from './provider-auth.js'

export const DEFAULT_CLAUDE_QUOTA_POLL_INTERVAL_MS = DEFAULT_CLAUDE_QUOTA_TTL_MS

export type ClaudeQuotaReader = Pick<
  ClaudeQuotaService,
  'getSnapshot' | 'refreshCredential' | 'refreshAll'
>

export interface ClaudeQuotaRefreshResult {
  pool: CredentialPoolView
  snapshots: Record<string, ClaudeQuotaSnapshot>
  activation?: CredentialPoolSwitchResult
  reloadActive?: boolean
}

export interface ClaudeCredentialCoordinatorOptions {
  providerAuthStore: ProviderAuthStore
  quotaReader?: ClaudeQuotaReader
  env?: NodeJS.ProcessEnv
  now?: () => number
  beforeActivation?(input: ClaudeGlobalActivationHookInput): Promise<void>
  activationFailed?(input: ClaudeGlobalActivationHookInput, error: unknown): Promise<void>
  resolveAccountId?: ClaudeAccountIdentityResolver
  validateGlobalAuth?: ClaudeGlobalAuthValidator
}

export type ClaudeGlobalActivationReason = 'auth_required' | 'manual_switch' | 'quota_threshold' | 'usage_limit'

export interface ClaudeGlobalActivationHookInput {
  previousCredentialId?: string
  targetCredentialId: string
  reason: ClaudeGlobalActivationReason
  triggerSessionName?: string
}

export interface RecoverClaudeUsageLimitInput {
  failedCredentialId?: string
  resetAt?: string
  triggerSessionName?: string
}

export interface RecoverClaudeAuthRequiredInput {
  failedCredentialId?: string
  triggerSessionName?: string
  detail?: string
}

export interface RetryClaudeReactiveActivationInput {
  reason: 'auth_required' | 'usage_limit'
  excludedCredentialIds: ReadonlySet<string>
  triggerSessionName?: string
}

function blockingResetAt(
  snapshot: ClaudeQuotaSnapshot,
  status: ReturnType<typeof evaluateClaudeQuotaEligibility>['status'],
  nowMs: number,
): string {
  const fallbackResetMs = nowMs + DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS
  const blockingWindows = status === 'blocked_weekly'
    ? snapshot.windows.filter((window) => {
        if (
          (window.kind !== 'seven_day' && window.kind !== 'weekly_scoped')
          || window.utilizationPct < 100
        ) {
          return false
        }
        if (!window.resetsAt) {
          return true
        }
        const resetMs = Date.parse(window.resetsAt)
        return Number.isFinite(resetMs) && resetMs > nowMs
      })
    : snapshot.windows.filter((window) => window.kind === 'five_hour').slice(0, 1)
  const resetTimes = blockingWindows.flatMap((window) => {
    if (!window.resetsAt) {
      return [fallbackResetMs]
    }
    const resetMs = Date.parse(window.resetsAt)
    return Number.isFinite(resetMs) && resetMs > nowMs ? [resetMs] : []
  })
  return new Date(resetTimes.length > 0 ? Math.max(...resetTimes) : fallbackResetMs).toISOString()
}

function buildBlockedResult(
  pool: CredentialPoolView,
  previousId: string | undefined,
): CredentialPoolSwitchResult {
  return {
    provider: 'claude',
    switched: false,
    ...(previousId ? {
      previousCredential: pool.credentials.find((credential) => credential.id === previousId),
    } : {}),
    ...(pool.active ? {
      activeCredential: pool.credentials.find((credential) => credential.id === pool.active),
    } : {}),
    blocked: {
      reason: 'no_ready_credentials',
      ...(pool.earliestExhaustedUntil
        ? { earliestExhaustedUntil: pool.earliestExhaustedUntil }
        : {}),
    },
    pool,
  }
}

function buildCurrentResult(
  pool: CredentialPoolView,
  previousId: string | undefined,
): CredentialPoolSwitchResult {
  return {
    provider: 'claude',
    switched: false,
    ...(previousId ? {
      previousCredential: pool.credentials.find((credential) => credential.id === previousId),
    } : {}),
    ...(pool.active ? {
      activeCredential: pool.credentials.find((credential) => credential.id === pool.active),
    } : {}),
    pool,
  }
}

export class ClaudeCredentialCoordinator {
  private readonly store: ProviderAuthStore
  private readonly quotaReader: ClaudeQuotaReader
  private readonly env: NodeJS.ProcessEnv
  private readonly now: () => number
  private readonly beforeActivation?: ClaudeCredentialCoordinatorOptions['beforeActivation']
  private readonly activationFailed?: ClaudeCredentialCoordinatorOptions['activationFailed']
  private readonly resolveAccountId?: ClaudeAccountIdentityResolver
  private readonly validateGlobalAuth?: ClaudeGlobalAuthValidator
  private queue: Promise<void> = Promise.resolve()

  constructor(options: ClaudeCredentialCoordinatorOptions) {
    this.store = options.providerAuthStore
    this.env = options.env ?? process.env
    this.quotaReader = options.quotaReader ?? new ClaudeQuotaService({
      cachePath: defaultClaudeQuotaCachePath(this.env),
    })
    this.now = options.now ?? Date.now
    this.beforeActivation = options.beforeActivation
    this.activationFailed = options.activationFailed
    this.resolveAccountId = options.resolveAccountId
    this.validateGlobalAuth = options.validateGlobalAuth
  }

  getQuotaSnapshot(credentialId: string): ClaudeQuotaSnapshot {
    return this.quotaReader.getSnapshot(credentialId)
  }

  async getGlobalActiveCredentialId(): Promise<string | undefined> {
    return this.store.getInstalledGlobalClaudeCredentialId()
  }

  async initialize(): Promise<ClaudeQuotaRefreshResult | null> {
    return this.enqueue(async () => {
      const reconciled = await this.store.reconcileGlobalClaudeCredential({
        env: this.env,
        ...(this.resolveAccountId ? { resolveAccountId: this.resolveAccountId } : {}),
        ...(this.validateGlobalAuth ? { validateGlobalAuth: this.validateGlobalAuth } : {}),
      })
      if (!reconciled) {
        return null
      }
      return this.refreshQuotaWithinLock({ force: true })
    })
  }

  async refreshQuota(
    options: { credentialId?: string; force?: boolean } = {},
  ): Promise<ClaudeQuotaRefreshResult> {
    return this.enqueue(() => this.refreshQuotaWithinLock(options))
  }

  async activateCredential(
    credentialId: string,
    options: Omit<ClaudeGlobalCredentialActivationOptions, 'env'> & {
      reason?: ClaudeGlobalActivationReason
    } = {},
  ): Promise<CredentialPoolSwitchResult> {
    return this.enqueue(async () => {
      const { reason = 'manual_switch', ...activationOptions } = options
      if (
        !activationOptions.sourceAuthoritative
        && this.quotaReader.getSnapshot(credentialId).fetchStatus === 'auth_required'
      ) {
        throw new Error('Claude credential requires login before global activation')
      }
      const manualEligibility = evaluateClaudeQuotaEligibility(
        this.quotaReader.getSnapshot(credentialId),
        { nowMs: this.now() },
      )
      if (
        !activationOptions.sourceAuthoritative
        && manualEligibility.fresh
        && !manualEligibility.eligibleCandidate
      ) {
        throw new Error('Claude credential does not have fresh quota headroom for global activation')
      }
      return this.activateWithinLock(credentialId, activationOptions, reason)
    })
  }

  async recoverUsageLimit(
    input: RecoverClaudeUsageLimitInput,
  ): Promise<CredentialPoolSwitchResult> {
    return this.enqueue(async () => {
      await this.store.synchronizeGlobalClaudeCredential({
        env: this.env,
        ...(this.resolveAccountId ? { resolveAccountId: this.resolveAccountId } : {}),
        ...(this.validateGlobalAuth ? { validateGlobalAuth: this.validateGlobalAuth } : {}),
      })
      const before = await this.store.listPoolCredentials('claude')
      const credentials = before.credentials.map((credential) => ({
        id: credential.id,
        absoluteDir: credential.absoluteDir,
      }))
      const snapshots = await this.quotaReader.refreshAll(credentials, { force: true })
      await this.reconcileFreshSnapshots(snapshots)

      let pool = await this.store.listPoolCredentials('claude')
      const activeId = pool.active
      const failedId = input.failedCredentialId ?? activeId
      if (failedId && failedId !== activeId) {
        const failedSnapshot = snapshots[failedId] ?? this.quotaReader.getSnapshot(failedId)
        if (failedSnapshot.fetchStatus !== 'fresh') {
          await this.store.reconcilePoolCredentialExhaustion(
            'claude',
            failedId,
            input.resetAt ?? new Date(
              this.now() + DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS,
            ).toISOString(),
          )
          pool = await this.store.listPoolCredentials('claude')
        }
        if (!activeId) {
          return buildBlockedResult(pool, failedId)
        }
        const currentSnapshot = snapshots[activeId] ?? this.quotaReader.getSnapshot(activeId)
        const currentEligibility = evaluateClaudeQuotaEligibility(currentSnapshot, {
          nowMs: this.now(),
        })
        const current = pool.credentials.find((credential) => credential.id === activeId)
        if (
          current?.readyLocal
          && !current.exhausted
          && (!currentEligibility.fresh || currentEligibility.eligibleCandidate)
        ) {
          return buildCurrentResult(pool, failedId)
        }
        if (current?.exhausted || currentEligibility.shouldSwitchActive) {
          const target = this.findReactiveRecoveryTarget(pool, activeId)
          if (target) {
            return this.activateWithinLock(target.id, {
              expectedActiveId: activeId,
              clearExhaustion: true,
            }, 'usage_limit', { triggerSessionName: input.triggerSessionName })
          }
        }
        return buildBlockedResult(pool, failedId)
      }

      if (!activeId) {
        return buildBlockedResult(pool, failedId)
      }
      const activeSnapshot = snapshots[activeId] ?? this.quotaReader.getSnapshot(activeId)
      const activeEligibility = evaluateClaudeQuotaEligibility(activeSnapshot, { nowMs: this.now() })
      if (activeEligibility.fresh && activeEligibility.eligibleCandidate) {
        return buildCurrentResult(pool, failedId)
      }

      await this.store.reconcilePoolCredentialExhaustion(
        'claude',
        activeId,
        input.resetAt
          ?? (activeEligibility.fresh
            ? blockingResetAt(activeSnapshot, activeEligibility.status, this.now())
            : new Date(this.now() + DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS).toISOString()),
      )
      pool = await this.store.listPoolCredentials('claude')
      const target = this.findReactiveRecoveryTarget(pool, activeId)
      if (!target) {
        return buildBlockedResult(pool, activeId)
      }
      return this.activateWithinLock(target.id, {
        expectedActiveId: activeId,
        clearExhaustion: true,
      }, 'usage_limit', { triggerSessionName: input.triggerSessionName })
    })
  }

  async recoverAuthRequired(
    input: RecoverClaudeAuthRequiredInput,
  ): Promise<CredentialPoolSwitchResult> {
    return this.enqueue(async () => {
      await this.store.synchronizeGlobalClaudeCredential({
        env: this.env,
        ...(this.resolveAccountId ? { resolveAccountId: this.resolveAccountId } : {}),
        ...(this.validateGlobalAuth ? { validateGlobalAuth: this.validateGlobalAuth } : {}),
      })
      let pool = await this.store.listPoolCredentials('claude')
      const activeId = pool.active
      const failedId = input.failedCredentialId ?? activeId
      if (!activeId || !failedId) {
        return buildBlockedResult(pool, failedId)
      }
      if (failedId !== activeId) {
        return buildCurrentResult(pool, failedId)
      }

      await this.store.markPoolCredentialAuthBroken(
        'claude',
        activeId,
        input.detail ?? 'Claude rejected the installed global OAuth credential',
      )
      pool = await this.store.listPoolCredentials('claude')
      const credentials = pool.credentials.map((credential) => ({
        id: credential.id,
        absoluteDir: credential.absoluteDir,
      }))
      const snapshots = await this.quotaReader.refreshAll(credentials, { force: true })
      await this.reconcileFreshSnapshots(snapshots, new Set([activeId]))
      pool = await this.store.listPoolCredentials('claude')
      const target = this.findReactiveRecoveryTarget(pool, activeId)
      if (!target) {
        return buildBlockedResult(pool, activeId)
      }
      return this.activateWithinLock(target.id, {
        expectedActiveId: activeId,
        sourceAuthoritative: true,
        clearExhaustion: true,
      }, 'auth_required', { triggerSessionName: input.triggerSessionName })
    })
  }

  async retryReactiveActivation(
    input: RetryClaudeReactiveActivationInput,
  ): Promise<CredentialPoolSwitchResult> {
    return this.enqueue(async () => {
      const pool = await this.store.listPoolCredentials('claude')
      const activeId = pool.active
      if (!activeId) {
        return buildBlockedResult(pool, undefined)
      }
      const target = this.findReactiveRecoveryTarget(
        pool,
        activeId,
        input.excludedCredentialIds,
      )
      if (!target) {
        return buildBlockedResult(pool, activeId)
      }
      return this.activateWithinLock(target.id, {
        expectedActiveId: activeId,
        ...(input.reason === 'auth_required' ? { sourceAuthoritative: true } : {}),
        clearExhaustion: true,
      }, input.reason, { triggerSessionName: input.triggerSessionName })
    })
  }

  private async refreshQuotaWithinLock(
    options: { credentialId?: string; force?: boolean },
  ): Promise<ClaudeQuotaRefreshResult> {
    const initial = await this.store.listPoolCredentials('claude')
    if (initial.credentials.length === 0) {
      if (options.credentialId) {
        throw new Error(`Credential "${options.credentialId}" is not registered for claude`)
      }
      return { pool: initial, snapshots: {} }
    }
    await this.store.synchronizeGlobalClaudeCredential({
      env: this.env,
      ...(this.resolveAccountId ? { resolveAccountId: this.resolveAccountId } : {}),
      ...(this.validateGlobalAuth ? { validateGlobalAuth: this.validateGlobalAuth } : {}),
    })
    const before = await this.store.listPoolCredentials('claude')
    const allCredentials = before.credentials.map((credential) => ({
      id: credential.id,
      absoluteDir: credential.absoluteDir,
    }))
    const selected = options.credentialId
      ? allCredentials.filter((credential) => credential.id === options.credentialId)
      : allCredentials
    if (options.credentialId && selected.length === 0) {
      throw new Error(`Credential "${options.credentialId}" is not registered for claude`)
    }

    const snapshots = options.credentialId
      ? Object.fromEntries(await Promise.all(selected.map(async (credential) => [
          credential.id,
          await this.quotaReader.refreshCredential(credential, { force: options.force }),
        ] as const)))
      : await this.quotaReader.refreshAll(selected, { force: options.force })
    await this.reconcileFreshSnapshots(snapshots)

    let pool = await this.store.listPoolCredentials('claude')
    const activeId = pool.active
    const activeSnapshot = activeId
      ? snapshots[activeId] ?? this.quotaReader.getSnapshot(activeId)
      : undefined
    const activeEligibility = activeSnapshot
      ? evaluateClaudeQuotaEligibility(activeSnapshot, { nowMs: this.now() })
      : undefined
    const activeCredential = pool.credentials.find((credential) => credential.id === activeId)
    const shouldRotate = Boolean(
      activeId
      && (
        !activeCredential?.readyLocal
        || activeCredential.exhausted
        || activeEligibility?.shouldSwitchActive
      ),
    )
    if (!activeId || !shouldRotate) {
      return {
        pool,
        snapshots,
        ...(activeEligibility?.eligibleCandidate ? { reloadActive: true } : {}),
      }
    }

    const target = this.findFreshEligibleTarget(pool, activeId)
    if (!target) {
      return { pool, snapshots }
    }
    const activation = await this.activateWithinLock(target.id, {
      expectedActiveId: activeId,
      clearExhaustion: true,
    }, 'quota_threshold')
    pool = activation.pool
    return {
      pool,
      snapshots,
      ...(activation.switched ? { activation } : {}),
    }
  }

  private async reconcileFreshSnapshots(
    snapshots: Readonly<Record<string, ClaudeQuotaSnapshot>>,
    preserveAuthBrokenIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const nowMs = this.now()
    const pool = await this.store.listPoolCredentials('claude')
    const authBrokenDirs = new Map(
      pool.credentials
        .filter((credential) => credential.authBrokenAt)
        .map((credential) => [credential.id, credential.absoluteDir]),
    )
    for (const [credentialId, snapshot] of Object.entries(snapshots)) {
      if (preserveAuthBrokenIds.has(credentialId)) {
        continue
      }
      if (snapshot.fetchStatus === 'auth_required') {
        await this.store.markPoolCredentialAuthBroken(
          'claude',
          credentialId,
          'Anthropic rejected the stored Claude OAuth access token',
        )
        continue
      }
      const eligibility = evaluateClaudeQuotaEligibility(snapshot, { nowMs })
      if (!eligibility.fresh || eligibility.status === 'unknown') {
        continue
      }
      const authBrokenDir = authBrokenDirs.get(credentialId)
      if (authBrokenDir) {
        // A fresh quota fetch alone is not proof the login recovered (the
        // access token can work while the refresh lineage is broken), so
        // quarantine clears only after the credential re-validates as a
        // logged-in Claude account.
        const validation = await this.validateGlobalAuth?.({
          ...this.env,
          [HERD_CLAUDE_GLOBAL_CONFIG_DIR]: authBrokenDir,
        }).catch(() => undefined)
        const validatedLogin = Boolean(
          validation?.loggedIn
          && (
            !validation.authMethod
            || ['claude.ai', 'oauth'].includes(validation.authMethod.toLowerCase())
          ),
        )
        if (validatedLogin) {
          await this.store.clearPoolCredentialAuthBroken('claude', credentialId)
        }
      }
      await this.store.reconcilePoolCredentialExhaustion(
        'claude',
        credentialId,
        eligibility.eligibleCandidate
          ? null
          : blockingResetAt(snapshot, eligibility.status, nowMs),
      )
    }
  }

  private findFreshEligibleTarget(
    pool: CredentialPoolView,
    activeId: string,
    excludedCredentialIds: ReadonlySet<string> = new Set(),
  ): CredentialPoolCredentialView | undefined {
    return pool.credentials.find((credential) => (
      credential.id !== activeId
      && !excludedCredentialIds.has(credential.id)
      && credential.readyLocal
      && !credential.exhausted
      && this.quotaReader.getSnapshot(credential.id).fetchStatus === 'fresh'
      && evaluateClaudeQuotaEligibility(this.quotaReader.getSnapshot(credential.id), {
        nowMs: this.now(),
      }).eligibleCandidate
    ))
  }

  private findReactiveRecoveryTarget(
    pool: CredentialPoolView,
    activeId: string,
    excludedCredentialIds: ReadonlySet<string> = new Set(),
  ): CredentialPoolCredentialView | undefined {
    const freshEligible = this.findFreshEligibleTarget(pool, activeId, excludedCredentialIds)
    if (freshEligible) {
      return freshEligible
    }
    const candidates = pool.credentials.filter((credential) => (
      credential.id !== activeId
      && !excludedCredentialIds.has(credential.id)
      && credential.readyLocal
      && !credential.exhausted
    ))
    const cachedEligible = candidates.find((credential) => {
      const snapshot = this.quotaReader.getSnapshot(credential.id)
      return snapshot.fetchStatus === 'cached'
        && evaluateClaudeQuotaEligibility(snapshot, { nowMs: this.now() }).eligibleCandidate
    })
    if (cachedEligible) {
      return cachedEligible
    }
    return candidates.find((credential) => {
      const snapshot = this.quotaReader.getSnapshot(credential.id)
      if (snapshot.fetchStatus === 'auth_required') {
        return false
      }
      const eligibility = evaluateClaudeQuotaEligibility(snapshot, { nowMs: this.now() })
      if (snapshot.fetchStatus === 'cached') {
        return eligibility.status === 'unknown'
      }
      return !eligibility.fresh || eligibility.status === 'unknown'
    })
  }

  private async activateWithinLock(
    credentialId: string,
    options: Omit<ClaudeGlobalCredentialActivationOptions, 'env'>,
    reason: ClaudeGlobalActivationReason,
    context: { triggerSessionName?: string } = {},
  ): Promise<CredentialPoolSwitchResult> {
    const pool = await this.store.listPoolCredentials('claude')
    const previousCredentialId = pool.active
    if (options.expectedActiveId && previousCredentialId !== options.expectedActiveId) {
      return this.store.activateGlobalClaudeCredential(credentialId, {
        ...options,
        env: this.env,
        ...(this.resolveAccountId ? { resolveAccountId: this.resolveAccountId } : {}),
        ...(this.validateGlobalAuth ? { validateGlobalAuth: this.validateGlobalAuth } : {}),
      })
    }
    const hookInput: ClaudeGlobalActivationHookInput = {
      ...(previousCredentialId ? { previousCredentialId } : {}),
      targetCredentialId: credentialId,
      reason,
      ...(context.triggerSessionName ? { triggerSessionName: context.triggerSessionName } : {}),
    }
    const requiresProcessBarrier = previousCredentialId !== credentialId
      || options.sourceAuthoritative === true
    try {
      if (requiresProcessBarrier) {
        await this.beforeActivation?.(hookInput)
      }
      return await this.store.activateGlobalClaudeCredential(credentialId, {
        ...options,
        env: this.env,
        ...(this.resolveAccountId ? { resolveAccountId: this.resolveAccountId } : {}),
        ...(this.validateGlobalAuth ? { validateGlobalAuth: this.validateGlobalAuth } : {}),
      })
    } catch (error) {
      if (requiresProcessBarrier) {
        await this.activationFailed?.(hookInput, error)
      }
      throw error
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }
}
