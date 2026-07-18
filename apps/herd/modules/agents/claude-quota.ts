import type { Stats } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveHerdDataDir } from '../data-dir.js'
import { writeJsonFileAtomically } from '../json-file.js'

export const CLAUDE_QUOTA_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
export const DEFAULT_CLAUDE_QUOTA_TTL_MS = 90_000
export const DEFAULT_CLAUDE_QUOTA_REQUEST_SPACING_MS = 5_000
export const DEFAULT_CLAUDE_QUOTA_TIMEOUT_MS = 8_000
export const DEFAULT_CLAUDE_QUOTA_MAX_RESPONSE_BYTES = 256 * 1024
export const DEFAULT_CLAUDE_QUOTA_SWITCH_THRESHOLD_PCT = 100
export const DEFAULT_CLAUDE_QUOTA_CACHED_ELIGIBILITY_MAX_AGE_MS = 15 * 60 * 1000

const CLAUDE_QUOTA_CACHE_VERSION = 1
const MAX_CLAUDE_QUOTA_CACHE_BYTES = 512 * 1024
const MAX_CLAUDE_QUOTA_CACHE_CREDENTIALS = 100
const MAX_CLAUDE_QUOTA_CACHE_WINDOWS = 32
const MAX_CLAUDE_QUOTA_CACHE_FUTURE_SKEW_MS = 5 * 60 * 1000

const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10_000
const RATE_LIMIT_BACKOFF_FACTOR = 3
const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000

export type ClaudeQuotaFetchStatus =
  | 'fresh'
  | 'cached'
  | 'rate_limited'
  | 'failed'
  | 'auth_required'
  | 'never'

export type ClaudeQuotaWindowKind = 'five_hour' | 'seven_day' | 'weekly_scoped'

export type ClaudeQuotaErrorCode =
  | 'auth_required'
  | 'credential_changed'
  | 'http'
  | 'network'
  | 'parse'
  | 'rate_limited'
  | 'response_too_large'
  | 'timeout'

export interface ClaudeQuotaWindow {
  kind: ClaudeQuotaWindowKind
  label: string
  utilizationPct: number
  resetsAt?: string
  scope?: string
}

export interface ClaudeQuotaSnapshot {
  fetchStatus: ClaudeQuotaFetchStatus
  fetchedAt?: string
  nextRefreshAt?: string
  windows: ClaudeQuotaWindow[]
  errorCode?: ClaudeQuotaErrorCode
}

export type ClaudeQuotaEligibilityStatus =
  | 'ready'
  | 'near_limit'
  | 'blocked_5h'
  | 'blocked_weekly'
  | 'unknown'

export interface ClaudeQuotaEligibility {
  status: ClaudeQuotaEligibilityStatus
  fresh: boolean
  eligibleCandidate: boolean
  shouldSwitchActive: boolean
}

export interface ClaudeQuotaCredential {
  id: string
  absoluteDir: string
}

export interface ClaudeQuotaServiceOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  endpoint?: string
  ttlMs?: number
  requestSpacingMs?: number
  timeoutMs?: number
  maxResponseBytes?: number
  userAgent?: string
  rateLimitBackoffMs?: number
  maxRateLimitBackoffMs?: number
  cachePath?: string
}

export interface ClaudeQuotaRefreshOptions {
  force?: boolean
}

interface ClaudeCredentialRevision {
  mtimeMs: number
  ctimeMs: number
  size: number
  ino: number
}

interface LastGoodSnapshot {
  fetchedAt: string
  windows: ClaudeQuotaWindow[]
  credentialRevision: ClaudeCredentialRevision
}

interface PersistedClaudeQuotaCache {
  version: number
  credentials: Record<string, LastGoodSnapshot>
}

interface ClaudeQuotaAccessToken {
  accessToken: string
  expiresAt?: number
  refreshTokenPresent: boolean
  revision: ClaudeCredentialRevision
}

class QuotaParseError extends Error {}
class QuotaResponseTooLargeError extends Error {}
class ClaudeCredentialChangedDuringQuotaCheck extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function normalizeResetAt(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new QuotaParseError('Invalid quota reset timestamp')
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new QuotaParseError('Invalid quota reset timestamp')
  }
  return new Date(parsed).toISOString()
}

function readScopePart(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined
  }
  if (!isObject(value)) {
    return undefined
  }
  for (const key of ['display_name', 'displayName', 'id', 'name']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function parseScope(value: unknown): string | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const model = readScopePart(value.model)
  const surface = readScopePart(value.surface)
  return model ?? surface
}

function parseWindow(
  value: unknown,
  kind: ClaudeQuotaWindowKind,
  label: string,
  percentKey: 'percent' | 'utilization',
  scope?: string,
): ClaudeQuotaWindow {
  if (!isObject(value)) {
    throw new QuotaParseError(`Invalid ${label} quota window`)
  }
  const utilization = finiteNumber(value[percentKey])
  if (utilization === undefined) {
    throw new QuotaParseError(`Invalid ${label} quota utilization`)
  }
  const resetsAt = normalizeResetAt(value.resets_at)
  return {
    kind,
    label,
    utilizationPct: clampPercentage(utilization),
    ...(resetsAt ? { resetsAt } : {}),
    ...(scope ? { scope } : {}),
  }
}

/**
 * Normalize Anthropic's provider-specific quota body into a secret-free DTO.
 * Modern `limits[]` entries win over legacy top-level windows.
 */
export function parseClaudeQuotaResponse(value: unknown): ClaudeQuotaWindow[] {
  if (!isObject(value)) {
    throw new QuotaParseError('Claude quota response is not an object')
  }

  const windows: ClaudeQuotaWindow[] = []
  let modernFiveHour: ClaudeQuotaWindow | undefined
  let modernSevenDay: ClaudeQuotaWindow | undefined

  if (value.limits !== undefined && !Array.isArray(value.limits)) {
    throw new QuotaParseError('Claude quota limits are not an array')
  }
  for (const rawLimit of Array.isArray(value.limits) ? value.limits : []) {
    if (!isObject(rawLimit) || typeof rawLimit.kind !== 'string') {
      continue
    }
    if (rawLimit.kind === 'session') {
      modernFiveHour = parseWindow(rawLimit, 'five_hour', '5h', 'percent')
      continue
    }
    if (rawLimit.kind === 'weekly_all') {
      modernSevenDay = parseWindow(rawLimit, 'seven_day', '7d', 'percent')
      continue
    }
    if (rawLimit.kind === 'weekly_scoped') {
      const scope = parseScope(rawLimit.scope)
      if (!scope) {
        continue
      }
      windows.push(parseWindow(
        rawLimit,
        'weekly_scoped',
        `7d ${scope.toLowerCase()}`,
        'percent',
        scope,
      ))
    }
  }

  const fiveHour = modernFiveHour ?? (
    value.five_hour === undefined || value.five_hour === null
      ? undefined
      : parseWindow(value.five_hour, 'five_hour', '5h', 'utilization')
  )
  const sevenDay = modernSevenDay ?? (
    value.seven_day === undefined || value.seven_day === null
      ? undefined
      : parseWindow(value.seven_day, 'seven_day', '7d', 'utilization')
  )

  return [
    ...(fiveHour ? [fiveHour] : []),
    ...(sevenDay ? [sevenDay] : []),
    ...windows,
  ]
}

function windowCanStillBlock(window: ClaudeQuotaWindow, nowMs: number): boolean {
  if (!window.resetsAt) {
    return true
  }
  const resetsAt = Date.parse(window.resetsAt)
  return Number.isFinite(resetsAt) && resetsAt > nowMs
}

/**
 * Decide whether fresh provider quota requires leaving an active account and
 * whether the same account is safe as a rotation target. Cached/error data is
 * deliberately never actionable.
 */
export function evaluateClaudeQuotaEligibility(
  snapshot: ClaudeQuotaSnapshot,
  options: {
    nowMs?: number
    fiveHourThresholdPct?: number
    cachedEligibilityMaxAgeMs?: number
  } = {},
): ClaudeQuotaEligibility {
  const nowMs = options.nowMs ?? Date.now()
  const fresh = snapshot.fetchStatus === 'fresh'
  const cachedFetchedAtMs = snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : Number.NaN
  const cachedMaxAgeMs = Math.max(
    0,
    options.cachedEligibilityMaxAgeMs
      ?? DEFAULT_CLAUDE_QUOTA_CACHED_ELIGIBILITY_MAX_AGE_MS,
  )
  const cachedWithLastGood = snapshot.fetchStatus === 'cached'
    && snapshot.windows.length > 0
    && Number.isFinite(cachedFetchedAtMs)
    && cachedFetchedAtMs <= nowMs
    && nowMs - cachedFetchedAtMs <= cachedMaxAgeMs
  if (!fresh && !cachedWithLastGood) {
    return {
      status: 'unknown',
      fresh: false,
      eligibleCandidate: false,
      shouldSwitchActive: false,
    }
  }

  const threshold = Math.min(100, Math.max(0, options.fiveHourThresholdPct
    ?? DEFAULT_CLAUDE_QUOTA_SWITCH_THRESHOLD_PCT))
  const fiveHour = snapshot.windows.find((window) => window.kind === 'five_hour')
  const sevenDay = snapshot.windows.find((window) => window.kind === 'seven_day')
  const weeklyBlocked = snapshot.windows.some((window) => (
    (window.kind === 'seven_day' || window.kind === 'weekly_scoped')
    && windowCanStillBlock(window, nowMs)
    && window.utilizationPct >= 100
  ))
  const fiveHourBlocked = Boolean(
    fiveHour
    && windowCanStillBlock(fiveHour, nowMs)
    && fiveHour.utilizationPct >= threshold,
  )

  if (!fresh) {
    return {
      status: weeklyBlocked
        ? 'blocked_weekly'
        : fiveHourBlocked
          ? (fiveHour?.utilizationPct ?? 0) >= 100 ? 'blocked_5h' : 'near_limit'
          : 'unknown',
      fresh: false,
      eligibleCandidate: Boolean(
        (fiveHour || sevenDay)
        && !weeklyBlocked
        && !fiveHourBlocked,
      ),
      shouldSwitchActive: false,
    }
  }

  if (weeklyBlocked) {
    return {
      status: 'blocked_weekly',
      fresh: true,
      eligibleCandidate: false,
      shouldSwitchActive: true,
    }
  }
  if (!fiveHour && !sevenDay) {
    return {
      status: 'unknown',
      fresh: true,
      eligibleCandidate: false,
      shouldSwitchActive: false,
    }
  }
  if (fiveHourBlocked) {
    return {
      status: (fiveHour?.utilizationPct ?? 0) >= 100 ? 'blocked_5h' : 'near_limit',
      fresh: true,
      eligibleCandidate: false,
      shouldSwitchActive: true,
    }
  }
  return {
    status: 'ready',
    fresh: true,
    eligibleCandidate: true,
    shouldSwitchActive: false,
  }
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1_000
  }
  const target = Date.parse(trimmed)
  return Number.isFinite(target) ? Math.max(0, target - nowMs) : undefined
}

function cloneWindows(windows: readonly ClaudeQuotaWindow[]): ClaudeQuotaWindow[] {
  return windows.map((window) => ({ ...window }))
}

function cloneSnapshot(snapshot: ClaudeQuotaSnapshot): ClaudeQuotaSnapshot {
  return { ...snapshot, windows: cloneWindows(snapshot.windows) }
}

export function defaultClaudeQuotaCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHerdDataDir(env), 'credential-pools', 'claude', 'quota-cache.json')
}

function normalizeCachedWindow(value: unknown): ClaudeQuotaWindow | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const kind = value.kind
  if (kind !== 'five_hour' && kind !== 'seven_day' && kind !== 'weekly_scoped') {
    return undefined
  }
  const label = typeof value.label === 'string' ? value.label.trim().slice(0, 120) : ''
  const utilizationPct = finiteNumber(value.utilizationPct)
  if (
    !label
    || utilizationPct === undefined
    || utilizationPct < 0
    || utilizationPct > 100
  ) {
    return undefined
  }
  let resetsAt: string | undefined
  try {
    resetsAt = normalizeResetAt(value.resetsAt)
  } catch {
    return undefined
  }
  const scope = typeof value.scope === 'string'
    ? value.scope.trim().slice(0, 120) || undefined
    : undefined
  return {
    kind,
    label,
    utilizationPct,
    ...(resetsAt ? { resetsAt } : {}),
    ...(scope ? { scope } : {}),
  }
}

function normalizeLastGoodSnapshot(
  value: unknown,
  nowMs: number,
): LastGoodSnapshot | undefined {
  if (!isObject(value) || typeof value.fetchedAt !== 'string' || !Array.isArray(value.windows)) {
    return undefined
  }
  const fetchedAtMs = Date.parse(value.fetchedAt)
  if (
    !Number.isFinite(fetchedAtMs)
    || fetchedAtMs > nowMs + MAX_CLAUDE_QUOTA_CACHE_FUTURE_SKEW_MS
  ) {
    return undefined
  }
  if (value.windows.length > MAX_CLAUDE_QUOTA_CACHE_WINDOWS) {
    return undefined
  }
  const normalizedWindows = value.windows.map(normalizeCachedWindow)
  if (normalizedWindows.some((window) => !window)) {
    return undefined
  }
  const cachedRevision = value.credentialRevision
  if (!isObject(cachedRevision)) {
    return undefined
  }
  const revisionValues = ['mtimeMs', 'ctimeMs', 'size', 'ino'].map((key) => (
    finiteNumber(cachedRevision[key])
  ))
  if (revisionValues.some((revisionValue) => revisionValue === undefined || revisionValue < 0)) {
    return undefined
  }
  const windows = normalizedWindows as ClaudeQuotaWindow[]
  const [mtimeMs, ctimeMs, size, ino] = revisionValues as [number, number, number, number]
  return {
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    windows,
    credentialRevision: { mtimeMs, ctimeMs, size, ino },
  }
}

async function readLastGoodCache(
  filePath: string,
  nowMs: number,
): Promise<Map<string, LastGoodSnapshot>> {
  try {
    const contents = await readFile(filePath)
    if (contents.byteLength > MAX_CLAUDE_QUOTA_CACHE_BYTES) {
      return new Map()
    }
    const parsed = JSON.parse(contents.toString('utf8')) as unknown
    if (!isObject(parsed) || parsed.version !== CLAUDE_QUOTA_CACHE_VERSION || !isObject(parsed.credentials)) {
      return new Map()
    }
    const entries = Object.entries(parsed.credentials)
      .slice(0, MAX_CLAUDE_QUOTA_CACHE_CREDENTIALS)
      .flatMap(([credentialId, value]) => {
        const id = credentialId.trim().slice(0, 160)
        const snapshot = normalizeLastGoodSnapshot(value, nowMs)
        return id && snapshot ? [[id, snapshot] as const] : []
      })
    return new Map(entries)
  } catch {
    return new Map()
  }
}

async function writeLastGoodCache(
  filePath: string,
  lastGood: ReadonlyMap<string, LastGoodSnapshot>,
): Promise<void> {
  const cache: PersistedClaudeQuotaCache = {
    version: CLAUDE_QUOTA_CACHE_VERSION,
    credentials: Object.fromEntries(
      [...lastGood.entries()].slice(0, MAX_CLAUDE_QUOTA_CACHE_CREDENTIALS).map(([id, snapshot]) => [
        id,
        {
          fetchedAt: snapshot.fetchedAt,
          windows: cloneWindows(snapshot.windows),
          credentialRevision: { ...snapshot.credentialRevision },
        },
      ]),
    ),
  }
  await writeJsonFileAtomically(filePath, cache, {
    mode: 0o600,
    trailingNewline: true,
  })
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new QuotaResponseTooLargeError('Claude quota response is too large')
  }
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      bytes += result.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new QuotaResponseTooLargeError('Claude quota response is too large')
      }
      text += decoder.decode(result.value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The status code is already authoritative; body cleanup is best effort.
  }
}

function credentialRevision(value: Stats): ClaudeCredentialRevision {
  return {
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs,
    size: value.size,
    ino: value.ino,
  }
}

function sameCredentialRevision(
  left: ClaudeCredentialRevision,
  right: ClaudeCredentialRevision,
): boolean {
  return left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.size === right.size
    && left.ino === right.ino
}

async function credentialRevisionStillMatches(
  filePath: string,
  expected: ClaudeCredentialRevision,
): Promise<boolean> {
  try {
    return sameCredentialRevision(credentialRevision(await stat(filePath)), expected)
  } catch {
    return false
  }
}

async function readAccessToken(absoluteDir: string): Promise<ClaudeQuotaAccessToken | undefined> {
  const filePath = path.join(absoluteDir, '.credentials.json')
  try {
    const before = credentialRevision(await stat(filePath))
    const contents = await readFile(filePath)
    const after = credentialRevision(await stat(filePath))
    if (!sameCredentialRevision(before, after)) {
      throw new ClaudeCredentialChangedDuringQuotaCheck()
    }
    if (contents.byteLength > 1024 * 1024) {
      return undefined
    }
    const parsed = JSON.parse(contents.toString('utf8')) as unknown
    if (!isObject(parsed) || !isObject(parsed.claudeAiOauth)) {
      return undefined
    }
    const accessToken = parsed.claudeAiOauth.accessToken
    const refreshToken = parsed.claudeAiOauth.refreshToken
    const rawExpiresAt = parsed.claudeAiOauth.expiresAt
    const expiresAt = typeof rawExpiresAt === 'number'
      ? rawExpiresAt
      : Number.parseInt(typeof rawExpiresAt === 'string' ? rawExpiresAt.trim() : '', 10)
    return typeof accessToken === 'string' && accessToken.trim()
      ? {
          accessToken: accessToken.trim(),
          refreshTokenPresent: typeof refreshToken === 'string' && Boolean(refreshToken.trim()),
          ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { expiresAt } : {}),
          revision: after,
        }
      : undefined
  } catch (error) {
    if (error instanceof ClaudeCredentialChangedDuringQuotaCheck) {
      throw error
    }
    return undefined
  }
}

export class ClaudeQuotaService {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly endpoint: string
  private readonly ttlMs: number
  private readonly requestSpacingMs: number
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly userAgent: string
  private readonly rateLimitBackoffMs: number
  private readonly maxRateLimitBackoffMs: number
  private readonly cachePath?: string
  private readonly snapshots = new Map<string, ClaudeQuotaSnapshot>()
  private readonly lastGood = new Map<string, LastGoodSnapshot>()
  private readonly nextFetchAt = new Map<string, number>()
  private readonly rateLimitStreaks = new Map<string, number>()
  private readonly inFlight = new Map<string, Promise<ClaudeQuotaSnapshot>>()
  private nextRequestAt = 0
  private pacingTail: Promise<void> = Promise.resolve()
  private cacheLoad?: Promise<void>
  private cacheWriteTail: Promise<void> = Promise.resolve()

  constructor(options: ClaudeQuotaServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.endpoint = options.endpoint ?? CLAUDE_QUOTA_ENDPOINT
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_CLAUDE_QUOTA_TTL_MS)
    this.requestSpacingMs = Math.max(0, options.requestSpacingMs
      ?? DEFAULT_CLAUDE_QUOTA_REQUEST_SPACING_MS)
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_CLAUDE_QUOTA_TIMEOUT_MS)
    this.maxResponseBytes = Math.max(1, options.maxResponseBytes
      ?? DEFAULT_CLAUDE_QUOTA_MAX_RESPONSE_BYTES)
    this.userAgent = options.userAgent?.trim() || 'claude-code'
    this.rateLimitBackoffMs = Math.max(0, options.rateLimitBackoffMs
      ?? DEFAULT_RATE_LIMIT_BACKOFF_MS)
    this.maxRateLimitBackoffMs = Math.max(0, options.maxRateLimitBackoffMs
      ?? MAX_RATE_LIMIT_BACKOFF_MS)
    this.cachePath = options.cachePath?.trim() || undefined
  }

  getSnapshot(credentialId: string): ClaudeQuotaSnapshot {
    const snapshot = this.snapshots.get(credentialId)
    if (!snapshot) {
      return { fetchStatus: 'never', windows: [] }
    }
    if (snapshot.fetchStatus === 'fresh' && this.now() >= (this.nextFetchAt.get(credentialId) ?? 0)) {
      return cloneSnapshot({ ...snapshot, fetchStatus: 'cached' })
    }
    return cloneSnapshot(snapshot)
  }

  async refreshCredential(
    credential: ClaudeQuotaCredential,
    options: ClaudeQuotaRefreshOptions = {},
  ): Promise<ClaudeQuotaSnapshot> {
    await this.ensureCacheLoaded()
    await this.invalidateCacheAfterCredentialChange(credential)
    const existing = this.inFlight.get(credential.id)
    if (existing) {
      return existing.then(cloneSnapshot)
    }
    if (!options.force && this.now() < (this.nextFetchAt.get(credential.id) ?? 0)) {
      return this.getSnapshot(credential.id)
    }

    const refresh = this.fetchCredential(credential)
    this.inFlight.set(credential.id, refresh)
    try {
      return cloneSnapshot(await refresh)
    } finally {
      this.inFlight.delete(credential.id)
    }
  }

  async refreshAll(
    credentials: readonly ClaudeQuotaCredential[],
    options: ClaudeQuotaRefreshOptions = {},
  ): Promise<Record<string, ClaudeQuotaSnapshot>> {
    const entries = await Promise.all(credentials.map(async (credential) => (
      [credential.id, await this.refreshCredential(credential, options)] as const
    )))
    return Object.fromEntries(entries)
  }

  private async fetchCredential(credential: ClaudeQuotaCredential): Promise<ClaudeQuotaSnapshot> {
    const credentialPath = path.join(credential.absoluteDir, '.credentials.json')
    let auth: ClaudeQuotaAccessToken | undefined
    try {
      auth = await readAccessToken(credential.absoluteDir)
    } catch (error) {
      if (error instanceof ClaudeCredentialChangedDuringQuotaCheck) {
        return this.recordCredentialChanged(credential.id)
      }
      throw error
    }
    if (!auth) {
      return this.recordAuthRequired(credential.id)
    }

    await this.awaitRequestSlot()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': this.userAgent,
        },
        signal: controller.signal,
      })

      if (!(await credentialRevisionStillMatches(credentialPath, auth.revision))) {
        await discardResponseBody(response)
        return this.recordCredentialChanged(credential.id)
      }

      if (response.status === 401 || response.status === 403) {
        await discardResponseBody(response)
        // Inactive pool accounts are refreshed by Claude only after activation.
        // Their expired access token does not prove the refresh lineage is broken.
        if (
          auth.refreshTokenPresent
          && auth.expiresAt !== undefined
          && auth.expiresAt <= this.now()
        ) {
          return this.recordFailure(credential.id, 'failed', 'http')
        }
        return this.recordAuthRequired(credential.id)
      }
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), this.now())
        await discardResponseBody(response)
        return this.recordRateLimit(credential.id, retryAfterMs)
      }
      if (!response.ok) {
        await discardResponseBody(response)
        return this.recordFailure(credential.id, 'failed', 'http')
      }

      try {
        const text = await readBoundedBody(response, this.maxResponseBytes)
        const windows = parseClaudeQuotaResponse(JSON.parse(text) as unknown)
        if (!(await credentialRevisionStillMatches(credentialPath, auth.revision))) {
          return this.recordCredentialChanged(credential.id)
        }
        const snapshot = await this.recordSuccess(credential.id, auth.revision, windows)
        if (!(await credentialRevisionStillMatches(credentialPath, auth.revision))) {
          return this.recordCredentialChanged(credential.id)
        }
        return snapshot
      } catch (error) {
        return this.recordFailure(
          credential.id,
          'failed',
          controller.signal.aborted
            ? 'timeout'
            : error instanceof QuotaResponseTooLargeError ? 'response_too_large' : 'parse',
        )
      }
    } catch {
      if (!(await credentialRevisionStillMatches(credentialPath, auth.revision))) {
        return this.recordCredentialChanged(credential.id)
      }
      return this.recordFailure(
        credential.id,
        'failed',
        controller.signal.aborted ? 'timeout' : 'network',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private async recordSuccess(
    credentialId: string,
    revision: ClaudeCredentialRevision,
    windows: ClaudeQuotaWindow[],
  ): Promise<ClaudeQuotaSnapshot> {
    const now = this.now()
    const fetchedAt = new Date(now).toISOString()
    const nextAt = now + this.ttlMs
    const lastGood = {
      fetchedAt,
      windows: cloneWindows(windows),
      credentialRevision: { ...revision },
    }
    this.lastGood.set(credentialId, lastGood)
    this.rateLimitStreaks.delete(credentialId)
    this.nextFetchAt.set(credentialId, nextAt)
    const snapshot: ClaudeQuotaSnapshot = {
      fetchStatus: 'fresh',
      fetchedAt,
      nextRefreshAt: new Date(nextAt).toISOString(),
      windows: cloneWindows(windows),
    }
    this.snapshots.set(credentialId, snapshot)
    await this.persistLastGoodCache()
    return snapshot
  }

  private recordRateLimit(credentialId: string, retryAfterMs?: number): ClaudeQuotaSnapshot {
    const streak = (this.rateLimitStreaks.get(credentialId) ?? 0) + 1
    this.rateLimitStreaks.set(credentialId, streak)
    const exponentialBackoff = this.rateLimitBackoffMs * RATE_LIMIT_BACKOFF_FACTOR ** (streak - 1)
    const deferMs = retryAfterMs === undefined
      ? this.ttlMs + Math.min(this.maxRateLimitBackoffMs, exponentialBackoff)
      : Math.max(this.ttlMs, Math.min(this.maxRateLimitBackoffMs, retryAfterMs))
    return this.recordFailure(
      credentialId,
      'rate_limited',
      'rate_limited',
      deferMs,
    )
  }

  private recordFailure(
    credentialId: string,
    fetchStatus: Exclude<ClaudeQuotaFetchStatus, 'fresh' | 'cached' | 'never'>,
    errorCode: ClaudeQuotaErrorCode,
    deferMs = this.ttlMs,
  ): ClaudeQuotaSnapshot {
    const now = this.now()
    const nextAt = now + Math.max(0, deferMs)
    const good = this.lastGood.get(credentialId)
    this.nextFetchAt.set(credentialId, nextAt)
    const snapshot: ClaudeQuotaSnapshot = {
      fetchStatus: good && fetchStatus !== 'auth_required' ? 'cached' : fetchStatus,
      ...(good ? { fetchedAt: good.fetchedAt } : {}),
      nextRefreshAt: new Date(nextAt).toISOString(),
      windows: good ? cloneWindows(good.windows) : [],
      errorCode,
    }
    this.snapshots.set(credentialId, snapshot)
    return snapshot
  }

  private async recordAuthRequired(credentialId: string): Promise<ClaudeQuotaSnapshot> {
    this.lastGood.delete(credentialId)
    const snapshot = this.recordFailure(credentialId, 'auth_required', 'auth_required')
    await this.persistLastGoodCache()
    return snapshot
  }

  private async recordCredentialChanged(credentialId: string): Promise<ClaudeQuotaSnapshot> {
    this.lastGood.delete(credentialId)
    this.snapshots.delete(credentialId)
    this.nextFetchAt.delete(credentialId)
    const snapshot = this.recordFailure(credentialId, 'failed', 'credential_changed')
    await this.persistLastGoodCache()
    return snapshot
  }

  private async invalidateCacheAfterCredentialChange(
    credential: ClaudeQuotaCredential,
  ): Promise<void> {
    const good = this.lastGood.get(credential.id)
    if (!good) {
      return
    }
    try {
      const currentRevision = credentialRevision(await stat(
        path.join(credential.absoluteDir, '.credentials.json'),
      ))
      if (sameCredentialRevision(currentRevision, good.credentialRevision)) {
        return
      }
      this.lastGood.delete(credential.id)
      this.snapshots.delete(credential.id)
      this.nextFetchAt.delete(credential.id)
      await this.persistLastGoodCache()
    } catch {
      // Missing/invalid credentials are classified by readAccessToken below.
    }
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (!this.cachePath) {
      return
    }
    this.cacheLoad ??= (async () => {
      const cached = await readLastGoodCache(this.cachePath!, this.now())
      for (const [credentialId, snapshot] of cached) {
        if (this.lastGood.has(credentialId)) {
          continue
        }
        const cloned = {
          fetchedAt: snapshot.fetchedAt,
          windows: cloneWindows(snapshot.windows),
          credentialRevision: { ...snapshot.credentialRevision },
        }
        this.lastGood.set(credentialId, cloned)
        this.snapshots.set(credentialId, {
          fetchStatus: 'cached',
          fetchedAt: cloned.fetchedAt,
          windows: cloneWindows(cloned.windows),
        })
      }
    })()
    await this.cacheLoad
  }

  private async persistLastGoodCache(): Promise<void> {
    if (!this.cachePath) {
      return
    }
    const write = this.cacheWriteTail.then(() => writeLastGoodCache(
      this.cachePath!,
      this.lastGood,
    ))
    this.cacheWriteTail = write.catch(() => undefined)
    try {
      await write
    } catch (error) {
      console.warn('[agents/provider-auth] failed to persist secret-free Claude quota cache', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async awaitRequestSlot(): Promise<void> {
    let release!: () => void
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.pacingTail.catch(() => undefined)
    this.pacingTail = previous.then(() => turn)
    await previous
    try {
      const now = this.now()
      const waitMs = Math.max(0, this.nextRequestAt - now)
      if (waitMs > 0) {
        await this.sleep(waitMs)
      }
      this.nextRequestAt = Math.max(this.nextRequestAt, this.now()) + this.requestSpacingMs
    } finally {
      release()
    }
  }
}
