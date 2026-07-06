import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat, writeFile, access } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveHerdDataDir } from '../data-dir.js'
import type { AgentType, MachineConfig } from './types.js'
import type { PreparedMachineLaunchEnvironment } from './machine-credentials.js'
import { HERD_MACHINE_ENV_PREFIX } from './machine-credentials.js'

const PROVIDER_AUTH_STORE_VERSION = 1
const REFRESH_BUFFER_MS = 60_000
export const DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS = 60 * 60 * 1000
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_REDIRECT_PORT = 1455
export const HERD_CODEX_AUTH_JSON_B64 = 'HERD_CODEX_AUTH_JSON_B64'
export const HERD_CODEX_REMOTE_HOME_KEY = 'HERD_CODEX_REMOTE_HOME_KEY'
const nodeSqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

export type ProviderAuthStatus = 'ready' | 'auth_required' | 'unknown'
export type ProviderAuthMethod = 'oauth' | 'api-key' | 'login' | 'missing'
export type ProviderAuthScopeId = string

export interface ProviderTokenRecord {
  access: string
  refresh?: string
  idToken?: string
  expiresAt: number
  accountId?: string
  email?: string
  updatedAt?: string
}

export interface ProviderAuthSnapshot {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  status: ProviderAuthStatus
  lastCheckedAt: string
  accountId?: string
  accountEmail?: string
  detail?: string
  reauthUrl?: string
  authMethod?: ProviderAuthMethod
}

export interface ProviderSpawnAuth {
  provider: AgentType
  snapshot: ProviderAuthSnapshot
  env?: NodeJS.ProcessEnv
  credentialPoolId?: string
}

export interface PersistedProviderAuthStore {
  version: number
  providers: Record<string, Record<string, ProviderTokenRecord>>
  snapshots: Record<string, ProviderAuthSnapshot>
  oauthFlows?: Record<string, ProviderOAuthFlowRecord>
  credentialPools?: Partial<Record<CredentialPoolProvider, CredentialPoolState>>
}

export type CredentialPoolProvider = 'claude' | 'codex'
export type CredentialPoolCredentialStatus = 'active' | 'available' | 'exhausted' | 'auth_required'
export type CredentialPoolRemoteReadiness = 'ready' | 'auth_required' | 'not_required'

export interface CredentialPoolCredentialReadiness {
  local: ProviderAuthStatus
  remote: CredentialPoolRemoteReadiness
  readyLocal: boolean
  readyRemote: boolean
  remoteTokenPresent: boolean
  remoteTokenLength?: number
}

export interface CredentialPoolCredential {
  id: string
  label: string
  dir: string
  email?: string
  remoteToken?: string
  remoteHomeKey?: string
  createdAt?: string
  lastUsedAt?: string
  exhaustedAt?: string
  exhaustedUntil?: string
}

export interface CredentialPoolState {
  active?: string
  credentials: Record<string, CredentialPoolCredential>
  exhausted: string[]
}

export interface CredentialPoolCredentialView extends Omit<CredentialPoolCredential, 'remoteToken' | 'remoteHomeKey'> {
  absoluteDir: string
  active: boolean
  exhausted: boolean
  status: CredentialPoolCredentialStatus
  readiness: CredentialPoolCredentialReadiness
  readyLocal: boolean
  readyRemote: boolean
  remoteTokenPresent?: boolean
  remoteTokenLength?: number
}

export interface CredentialPoolView {
  provider: CredentialPoolProvider
  root: string
  active?: string
  credentials: CredentialPoolCredentialView[]
  nextCredential?: CredentialPoolCredentialView
  readyCount: number
  earliestExhaustedUntil?: string
}

interface CredentialPoolCredentialInternalView extends CredentialPoolCredentialView {
  remoteToken?: string
  remoteHomeKey?: string
}

interface CredentialPoolInternalView extends Omit<CredentialPoolView, 'credentials' | 'nextCredential'> {
  credentials: CredentialPoolCredentialInternalView[]
  nextCredential?: CredentialPoolCredentialInternalView
}

export interface CredentialPoolInstructions {
  directory: string
  commands: string[]
}

export interface CredentialPoolCommand {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  display: string
}

export interface CredentialPoolRegisterResult {
  provider: CredentialPoolProvider
  credential: CredentialPoolCredentialView
  pool: CredentialPoolView
  instructions: CredentialPoolInstructions
}

export interface CredentialPoolSwitchResult {
  provider: CredentialPoolProvider
  switched: boolean
  previousCredential?: CredentialPoolCredentialView
  activeCredential?: CredentialPoolCredentialView
  blocked?: {
    reason: 'no_ready_credentials'
    earliestExhaustedUntil?: string
  }
  pool: CredentialPoolView
}

export interface ProviderOAuthFlowRecord {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  state: string
  codeVerifier: string
  codeChallenge: string
  redirectUri: string
  createdAt: string
  expiresAt: string
}

export interface ProviderOAuthStartResult {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  state: string
  authorizationUrl: string
  callbackUrl: string
  expiresAt: string
}

export interface ProviderOAuthCompleteResult {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  token: ProviderTokenRecord
  snapshot: ProviderAuthSnapshot
}

export class ProviderAuthRequiredError extends Error {
  readonly code = 'AUTH_REQUIRED'
  readonly provider: AgentType
  readonly snapshot: ProviderAuthSnapshot

  constructor(provider: AgentType, snapshot: ProviderAuthSnapshot, message = 'Provider authentication is required') {
    super(message)
    this.name = 'ProviderAuthRequiredError'
    this.provider = provider
    this.snapshot = snapshot
  }
}

export function defaultProviderAuthStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHerdDataDir(env), 'provider-secrets.json')
}

export function defaultCredentialPoolsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHerdDataDir(env), 'credential-pools')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  const text = asTrimmedString(value)
  if (!text) {
    return undefined
  }
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function normalizeTokenRecord(raw: unknown): ProviderTokenRecord | null {
  if (!isObject(raw)) {
    return null
  }
  const access = asTrimmedString(raw.access)
  const expiresAt = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)
    ? raw.expiresAt
    : undefined
  if (!access || expiresAt === undefined) {
    return null
  }
  return {
    access,
    expiresAt,
    ...(asTrimmedString(raw.refresh) ? { refresh: asTrimmedString(raw.refresh) } : {}),
    ...(asTrimmedString(raw.idToken) ? { idToken: asTrimmedString(raw.idToken) } : {}),
    ...(asTrimmedString(raw.accountId) ? { accountId: asTrimmedString(raw.accountId) } : {}),
    ...(asTrimmedString(raw.email) ? { email: asTrimmedString(raw.email) } : {}),
    ...(asTrimmedString(raw.updatedAt) ? { updatedAt: asTrimmedString(raw.updatedAt) } : {}),
  }
}

function normalizeSnapshot(raw: unknown): ProviderAuthSnapshot | null {
  if (!isObject(raw)) {
    return null
  }
  const provider = asTrimmedString(raw.provider) as AgentType | undefined
  const scopeId = asTrimmedString(raw.scopeId)
  const host = asTrimmedString(raw.host)
  const status = raw.status === 'ready' || raw.status === 'auth_required' || raw.status === 'unknown'
    ? raw.status
    : undefined
  const lastCheckedAt = asTrimmedString(raw.lastCheckedAt)
  if (!provider || !scopeId || !host || !status || !lastCheckedAt) {
    return null
  }
  const persistedAuthMethod = asTrimmedString(raw.authMethod) as ProviderAuthMethod | undefined
  const nativeCodexSnapshot = provider === 'codex' && !providerUsesManagedOAuth(provider)
  const authMethod = nativeCodexSnapshot && (persistedAuthMethod === 'oauth' || persistedAuthMethod === 'missing')
    ? 'login'
    : persistedAuthMethod
  const rawDetail = asTrimmedString(raw.detail)
  const detail = nativeCodexSnapshot && rawDetail && /\b(?:oauth|re-auth|managed provider token|managed codex)\b/iu.test(rawDetail)
    ? (status === 'ready'
        ? 'Using Codex CLI credentials from the target environment.'
        : buildProviderNativeAuthDetail(provider, host) ?? rawDetail)
    : rawDetail
  const reauthUrl = providerUsesManagedOAuth(provider) ? asTrimmedString(raw.reauthUrl) : undefined
  return {
    provider,
    scopeId,
    host,
    status,
    lastCheckedAt,
    ...(asTrimmedString(raw.accountId) ? { accountId: asTrimmedString(raw.accountId) } : {}),
    ...(asTrimmedString(raw.accountEmail) ? { accountEmail: asTrimmedString(raw.accountEmail) } : {}),
    ...(detail ? { detail } : {}),
    ...(reauthUrl ? { reauthUrl } : {}),
    ...(authMethod ? { authMethod } : {}),
  }
}

function normalizeFlow(raw: unknown): ProviderOAuthFlowRecord | null {
  if (!isObject(raw)) {
    return null
  }
  const provider = asTrimmedString(raw.provider) as AgentType | undefined
  const scopeId = asTrimmedString(raw.scopeId)
  const host = asTrimmedString(raw.host)
  const state = asTrimmedString(raw.state)
  const codeVerifier = asTrimmedString(raw.codeVerifier)
  const codeChallenge = asTrimmedString(raw.codeChallenge)
  const redirectUri = asTrimmedString(raw.redirectUri)
  const createdAt = asTrimmedString(raw.createdAt)
  const expiresAt = asTrimmedString(raw.expiresAt)
  if (!provider || !scopeId || !host || !state || !codeVerifier || !codeChallenge || !redirectUri || !createdAt || !expiresAt) {
    return null
  }
  return { provider, scopeId, host, state, codeVerifier, codeChallenge, redirectUri, createdAt, expiresAt }
}

const CREDENTIAL_POOL_PROVIDERS: readonly CredentialPoolProvider[] = ['claude', 'codex']

function isCredentialPoolProvider(provider: AgentType): provider is CredentialPoolProvider {
  return CREDENTIAL_POOL_PROVIDERS.includes(provider as CredentialPoolProvider)
}

function normalizeCredentialId(value: unknown): string | null {
  const id = asTrimmedString(value)
  return id && /^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(id) ? id : null
}

function normalizeCredentialPoolDir(
  provider: CredentialPoolProvider,
  id: string,
  raw: unknown,
): string {
  const fallback = `${provider}/${id}`
  const value = asTrimmedString(raw)?.replace(/\\/gu, '/')
  if (!value || path.isAbsolute(value)) {
    return fallback
  }
  const parts = value.split('/')
  if (
    parts.length !== 2
    || parts[0] !== provider
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    return fallback
  }
  return value
}

function normalizeRemoteHomeKey(raw: unknown): string | undefined {
  const value = asTrimmedString(raw)
  return value && /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : undefined
}

function normalizePoolCredential(
  provider: CredentialPoolProvider,
  id: string,
  raw: unknown,
): CredentialPoolCredential | null {
  if (!isObject(raw)) {
    return null
  }
  const label = asTrimmedString(raw.label) ?? id
  return {
    id,
    label,
    dir: normalizeCredentialPoolDir(provider, id, raw.dir),
    ...(asTrimmedString(raw.email) ? { email: asTrimmedString(raw.email) } : {}),
    ...(asTrimmedString(raw.remoteToken) ? { remoteToken: asTrimmedString(raw.remoteToken) } : {}),
    ...(normalizeRemoteHomeKey(raw.remoteHomeKey) ? { remoteHomeKey: normalizeRemoteHomeKey(raw.remoteHomeKey) } : {}),
    ...(asTrimmedString(raw.createdAt) ? { createdAt: asTrimmedString(raw.createdAt) } : {}),
    ...(asTrimmedString(raw.lastUsedAt) ? { lastUsedAt: asTrimmedString(raw.lastUsedAt) } : {}),
    ...(normalizeIsoTimestamp(raw.exhaustedAt) ? { exhaustedAt: normalizeIsoTimestamp(raw.exhaustedAt) } : {}),
    ...(normalizeIsoTimestamp(raw.exhaustedUntil) ? { exhaustedUntil: normalizeIsoTimestamp(raw.exhaustedUntil) } : {}),
  }
}

function normalizeCredentialPool(
  provider: CredentialPoolProvider,
  raw: unknown,
): CredentialPoolState {
  const state: CredentialPoolState = { credentials: {}, exhausted: [] }
  if (!isObject(raw)) {
    return state
  }
  if (isObject(raw.credentials)) {
    for (const [rawId, value] of Object.entries(raw.credentials)) {
      const id = normalizeCredentialId(rawId)
      if (!id) {
        continue
      }
      const credential = normalizePoolCredential(provider, id, value)
      if (credential) {
        state.credentials[id] = credential
      }
    }
  }
  if (Array.isArray(raw.exhausted)) {
    state.exhausted = [...new Set(raw.exhausted.map(normalizeCredentialId).filter((id): id is string => Boolean(id)))]
      .filter((id) => Boolean(state.credentials[id]))
  }
  const active = normalizeCredentialId(raw.active)
  if (active && state.credentials[active]) {
    state.active = active
  }
  return state
}

function emptyStore(): PersistedProviderAuthStore {
  return {
    version: PROVIDER_AUTH_STORE_VERSION,
    providers: {},
    snapshots: {},
    credentialPools: {},
  }
}

function normalizeStore(raw: unknown): PersistedProviderAuthStore {
  if (!isObject(raw)) {
    return emptyStore()
  }
  const store = emptyStore()
  if (isObject(raw.providers)) {
    for (const [provider, scopes] of Object.entries(raw.providers)) {
      if (!isObject(scopes)) {
        continue
      }
      for (const [scopeId, token] of Object.entries(scopes)) {
        const normalized = normalizeTokenRecord(token)
        if (!normalized) {
          continue
        }
        store.providers[provider] ??= {}
        store.providers[provider][scopeId] = normalized
      }
    }
  }
  if (isObject(raw.snapshots)) {
    for (const [key, snapshot] of Object.entries(raw.snapshots)) {
      const normalized = normalizeSnapshot(snapshot)
      if (normalized) {
        store.snapshots[key] = normalized
      }
    }
  }
  if (isObject(raw.oauthFlows)) {
    for (const [key, flow] of Object.entries(raw.oauthFlows)) {
      const normalized = normalizeFlow(flow)
      if (normalized && Date.parse(normalized.expiresAt) > Date.now()) {
        store.oauthFlows ??= {}
        store.oauthFlows[key] = normalized
      }
    }
  }
  if (isObject(raw.credentialPools)) {
    for (const provider of CREDENTIAL_POOL_PROVIDERS) {
      const normalized = normalizeCredentialPool(provider, raw.credentialPools[provider])
      if (Object.keys(normalized.credentials).length > 0) {
        store.credentialPools ??= {}
        store.credentialPools[provider] = normalized
      }
    }
  }
  return store
}

function snapshotKey(provider: AgentType, scopeId: string, host: string): string {
  return `${provider}:${scopeId}:${host}`
}

function flowKey(state: string): string {
  return `state:${state}`
}

function cloneToken(token: ProviderTokenRecord): ProviderTokenRecord {
  return { ...token }
}

function cloneSnapshot(snapshot: ProviderAuthSnapshot): ProviderAuthSnapshot {
  return { ...snapshot }
}

function cloneCredential(credential: CredentialPoolCredential): CredentialPoolCredential {
  return { ...credential }
}

function cloneCredentialPool(state: CredentialPoolState): CredentialPoolState {
  return {
    ...(state.active ? { active: state.active } : {}),
    credentials: Object.fromEntries(
      Object.entries(state.credentials).map(([id, credential]) => [id, cloneCredential(credential)]),
    ),
    exhausted: [...state.exhausted],
  }
}

function slugCredentialLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'credential'
}

function nextCredentialId(label: string, existing: Record<string, CredentialPoolCredential>): string {
  const base = slugCredentialLabel(label)
  if (!existing[base]) {
    return base
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`
    if (!existing[candidate]) {
      return candidate
    }
  }
  return `${base}-${randomUrlSafe(4).toLowerCase()}`
}

function newCredentialRemoteHomeKey(provider: CredentialPoolProvider, id: string): string {
  return `${provider}-${id}-${randomUrlSafe(10).toLowerCase()}`
}

function credentialRemoteHomeKey(credential: CredentialPoolCredentialInternalView): string {
  return credential.remoteHomeKey ?? `credential-pool-${credential.id}`
}

function orderedCredentials(pool: CredentialPoolState): CredentialPoolCredential[] {
  return Object.values(pool.credentials).sort((left, right) => left.id.localeCompare(right.id))
}

function resolveCredentialExhaustedUntil(
  credential: CredentialPoolCredential,
): string | undefined {
  if (credential.exhaustedUntil) {
    return credential.exhaustedUntil
  }
  if (!credential.exhaustedAt) {
    return undefined
  }
  const exhaustedAtMs = Date.parse(credential.exhaustedAt)
  if (!Number.isFinite(exhaustedAtMs)) {
    return undefined
  }
  return new Date(exhaustedAtMs + DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS).toISOString()
}

function isCredentialTemporarilyExhausted(
  credential: CredentialPoolCredential,
  nowMs = Date.now(),
): boolean {
  const exhaustedUntil = resolveCredentialExhaustedUntil(credential)
  return exhaustedUntil ? Date.parse(exhaustedUntil) > nowMs : false
}

function exhaustedIds(pool: CredentialPoolState, nowMs = Date.now()): Set<string> {
  return new Set(
    Object.values(pool.credentials)
      .filter((credential) => isCredentialTemporarilyExhausted(credential, nowMs))
      .map((credential) => credential.id),
  )
}

function clearCredentialExhaustion(credential: CredentialPoolCredential): void {
  delete credential.exhaustedAt
  delete credential.exhaustedUntil
}

function pruneExpiredCredentialExhaustion(pool: CredentialPoolState, nowMs = Date.now()): void {
  for (const credential of Object.values(pool.credentials)) {
    if (credential.exhaustedAt && !isCredentialTemporarilyExhausted(credential, nowMs)) {
      clearCredentialExhaustion(credential)
    }
  }
  const exhausted = exhaustedIds(pool, nowMs)
  pool.exhausted = pool.exhausted.filter((id) => exhausted.has(id))
}

function resolveExhaustedUntil(resetAt: string | undefined, nowMs = Date.now()): string {
  const parsedResetAt = resetAt ? Date.parse(resetAt) : Number.NaN
  if (Number.isFinite(parsedResetAt) && parsedResetAt > nowMs) {
    return new Date(parsedResetAt).toISOString()
  }
  return new Date(nowMs + DEFAULT_CREDENTIAL_POOL_EXHAUSTION_COOLDOWN_MS).toISOString()
}

function earliestFutureIso(values: Array<string | undefined>, nowMs = Date.now()): string | undefined {
  const earliest = values
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter((value) => Number.isFinite(value) && value > nowMs)
    .sort((left, right) => left - right)[0]
  return earliest ? new Date(earliest).toISOString() : undefined
}

function firstCredentialId(pool: CredentialPoolState): string | undefined {
  return orderedCredentials(pool)[0]?.id
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

export class ProviderAuthStore {
  private queue = Promise.resolve()

  constructor(
    private readonly filePath = defaultProviderAuthStorePath(),
    private readonly credentialPoolsRoot = defaultCredentialPoolsRoot(),
  ) {}

  async read(): Promise<PersistedProviderAuthStore> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizeStore(JSON.parse(raw) as unknown)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return emptyStore()
      }
      throw error
    }
  }

  async write(store: PersistedProviderAuthStore): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await chmod(this.filePath, 0o600)
  }

  async getToken(provider: AgentType, scopeId: string): Promise<ProviderTokenRecord | null> {
    const store = await this.read()
    const token = store.providers[provider]?.[scopeId]
    return token ? cloneToken(token) : null
  }

  async putToken(provider: AgentType, scopeId: string, token: ProviderTokenRecord): Promise<void> {
    await this.mutate((store) => {
      store.providers[provider] ??= {}
      store.providers[provider][scopeId] = cloneToken(token)
    })
  }

  async listSnapshots(): Promise<ProviderAuthSnapshot[]> {
    const store = await this.read()
    return Object.values(store.snapshots).map(cloneSnapshot)
  }

  async upsertSnapshot(snapshot: ProviderAuthSnapshot): Promise<void> {
    await this.mutate((store) => {
      store.snapshots[snapshotKey(snapshot.provider, snapshot.scopeId, snapshot.host)] = cloneSnapshot(snapshot)
    })
  }

  async createOAuthFlow(flow: ProviderOAuthFlowRecord): Promise<void> {
    await this.mutate((store) => {
      store.oauthFlows ??= {}
      store.oauthFlows[flowKey(flow.state)] = { ...flow }
    })
  }

  async consumeOAuthFlow(state: string): Promise<ProviderOAuthFlowRecord | null> {
    let consumed: ProviderOAuthFlowRecord | null = null
    await this.mutate((store) => {
      const key = flowKey(state)
      const flow = store.oauthFlows?.[key]
      if (flow && Date.parse(flow.expiresAt) > Date.now()) {
        consumed = { ...flow }
      }
      if (store.oauthFlows) {
        delete store.oauthFlows[key]
      }
    })
    return consumed
  }

  async listPoolCredentials(provider: AgentType): Promise<CredentialPoolView> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const store = await this.read()
    return this.buildPoolView(poolProvider, store.credentialPools?.[poolProvider] ?? { credentials: {}, exhausted: [] })
  }

  async listPoolCredentialsForSpawn(provider: AgentType): Promise<CredentialPoolInternalView> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const store = await this.read()
    return this.buildPoolView(
      poolProvider,
      store.credentialPools?.[poolProvider] ?? { credentials: {}, exhausted: [] },
      { includeSecrets: true },
    )
  }

  async getActivePoolCredential(provider: AgentType): Promise<CredentialPoolCredentialView | null> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const pool = await this.listPoolCredentials(poolProvider)
    if (pool.credentials.length === 0) {
      return null
    }
    return pool.credentials.find((credential) => credential.id === pool.active && isReadyCredentialView(credential))
      ?? pool.credentials.find(isReadyCredentialView)
      ?? null
  }

  async getPoolCredential(provider: AgentType, id: string): Promise<CredentialPoolCredentialView | null> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const credentialId = requireCredentialId(id)
    const pool = await this.listPoolCredentials(poolProvider)
    return pool.credentials.find((credential) => credential.id === credentialId) ?? null
  }

  async getPoolCredentialForSpawn(provider: AgentType, id: string): Promise<CredentialPoolCredentialInternalView | null> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const credentialId = requireCredentialId(id)
    const pool = await this.listPoolCredentialsForSpawn(poolProvider)
    return pool.credentials.find((credential) => credential.id === credentialId) ?? null
  }

  async putPoolCredentialRemoteToken(provider: AgentType, id: string, remoteToken: string): Promise<CredentialPoolView> {
    const poolProvider = requireCredentialPoolProvider(provider)
    if (poolProvider !== 'claude') {
      throw new Error(`${poolProvider} credential pools do not store remote tokens`)
    }
    const credentialId = requireCredentialId(id)
    const token = asTrimmedString(remoteToken)
    if (!token) {
      throw new Error('Remote token is empty')
    }
    await this.mutate((store) => {
      const pool = getMutableCredentialPool(store, poolProvider)
      const credential = pool.credentials[credentialId]
      if (!credential) {
        throw new Error(`Credential "${credentialId}" is not registered for ${poolProvider}`)
      }
      credential.remoteToken = token
    })
    return this.listPoolCredentials(poolProvider)
  }

  async registerPoolCredential(
    provider: AgentType,
    label = 'Credential',
    email?: string,
  ): Promise<CredentialPoolRegisterResult> {
    const poolProvider = requireCredentialPoolProvider(provider)
    let credential!: CredentialPoolCredential
    await this.mutate((store) => {
      store.credentialPools ??= {}
      const pool = store.credentialPools[poolProvider] ?? { credentials: {}, exhausted: [] }
      const id = nextCredentialId(label, pool.credentials)
      const now = new Date().toISOString()
      credential = {
        id,
        label: label.trim() || id,
        dir: `${poolProvider}/${id}`,
        remoteHomeKey: newCredentialRemoteHomeKey(poolProvider, id),
        createdAt: now,
        ...(email?.trim() ? { email: email.trim() } : {}),
      }
      pool.credentials[id] = credential
      if (!pool.active) {
        pool.active = id
      }
      store.credentialPools[poolProvider] = pool
    })
    const absoluteDir = this.resolveCredentialPoolCredentialDir(credential)
    await mkdir(absoluteDir, { recursive: true, mode: 0o700 })
    await chmod(absoluteDir, 0o700)
    const pool = await this.listPoolCredentials(poolProvider)
    const view = pool.credentials.find((entry) => entry.id === credential.id)
    if (!view) {
      throw new Error('Credential pool registration did not persist')
    }
    return {
      provider: poolProvider,
      credential: view,
      pool,
      instructions: buildPoolInstructions(poolProvider, absoluteDir),
    }
  }

  async markPoolCredentialExhausted(
    provider: AgentType,
    id: string,
    resetAt?: string,
  ): Promise<CredentialPoolView> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const credentialId = requireCredentialId(id)
    await this.mutate((store) => {
      const pool = getMutableCredentialPool(store, poolProvider)
      pruneExpiredCredentialExhaustion(pool)
      const credential = pool.credentials[credentialId]
      if (!credential) {
        throw new Error(`Credential "${credentialId}" is not registered for ${poolProvider}`)
      }
      const now = Date.now()
      credential.exhaustedAt = new Date(now).toISOString()
      credential.exhaustedUntil = resolveExhaustedUntil(resetAt, now)
      pool.exhausted = [...new Set([...pool.exhausted, credentialId])]
    })
    return this.listPoolCredentials(poolProvider)
  }

  async switchToNextPoolCredential(
    provider: AgentType,
    exhaustedId?: string,
    options: { resetAt?: string; host?: string } = {},
  ): Promise<CredentialPoolSwitchResult> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const exhaustedCredentialId = exhaustedId ? requireCredentialId(exhaustedId) : undefined
    let previousId: string | undefined
    let activeId: string | undefined
    let switched = false
    let blocked: CredentialPoolSwitchResult['blocked'] | undefined
    await this.mutateAsync(async (store) => {
      const pool = getMutableCredentialPool(store, poolProvider)
      const now = Date.now()
      const host = options.host?.trim() || 'local'
      pruneExpiredCredentialExhaustion(pool, now)
      previousId = pool.active ?? firstCredentialId(pool)
      let view: CredentialPoolInternalView | undefined
      const readPoolView = async (): Promise<CredentialPoolInternalView> => {
        view ??= await this.buildPoolView(poolProvider, pool, { includeSecrets: true })
        return view
      }
      if (exhaustedCredentialId) {
        const exhaustedCredential = pool.credentials[exhaustedCredentialId]
        if (!exhaustedCredential) {
          throw new Error(`Credential "${exhaustedCredentialId}" is not registered for ${poolProvider}`)
        }
        exhaustedCredential.exhaustedAt = new Date(now).toISOString()
        exhaustedCredential.exhaustedUntil = resolveExhaustedUntil(options.resetAt, now)
        pool.exhausted = [...new Set([...pool.exhausted, exhaustedCredentialId])]
        if (!previousId) {
          previousId = exhaustedCredentialId
        }
        if (previousId && exhaustedCredentialId !== previousId) {
          const activeCredential = (await readPoolView()).credentials.find((credential) => credential.id === previousId)
          if (activeCredential && isReadyPoolCredentialForHost(poolProvider, activeCredential, host)) {
            activeId = pool.active
            return
          }
        }
      } else if (previousId && pool.credentials[previousId]) {
        pool.credentials[previousId].exhaustedAt = new Date(now).toISOString()
        pool.credentials[previousId].exhaustedUntil = resolveExhaustedUntil(options.resetAt, now)
        pool.exhausted = [...new Set([...pool.exhausted, previousId])]
      }
      const poolView = await readPoolView()
      const next = poolView.credentials.find((credential) => (
        credential.id !== previousId && isReadyPoolCredentialForHost(poolProvider, credential, host)
      ))
      if (next) {
        pool.active = next.id
        pool.credentials[next.id].lastUsedAt = new Date(now).toISOString()
        activeId = next.id
        switched = true
      } else if (previousId && pool.credentials[previousId]) {
        pool.active = previousId
        activeId = previousId
        blocked = {
          reason: 'no_ready_credentials',
          ...(poolView.earliestExhaustedUntil ? { earliestExhaustedUntil: poolView.earliestExhaustedUntil } : {}),
        }
      }
    })
    const pool = await this.listPoolCredentials(poolProvider)
    return {
      provider: poolProvider,
      switched,
      ...(previousId ? { previousCredential: pool.credentials.find((credential) => credential.id === previousId) } : {}),
      ...(activeId ? { activeCredential: pool.credentials.find((credential) => credential.id === activeId) } : {}),
      ...(blocked ? { blocked } : {}),
      pool,
    }
  }

  async removePoolCredential(provider: AgentType, id: string): Promise<CredentialPoolView> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const credentialId = requireCredentialId(id)
    let dir: string | undefined
    await this.mutate((store) => {
      const pool = getMutableCredentialPool(store, poolProvider)
      pruneExpiredCredentialExhaustion(pool)
      const credential = pool.credentials[credentialId]
      if (!credential) {
        throw new Error(`Credential "${credentialId}" is not registered for ${poolProvider}`)
      }
      dir = credential.dir
      delete pool.credentials[credentialId]
      pool.exhausted = pool.exhausted.filter((entry) => entry !== credentialId)
      if (pool.active === credentialId) {
        const exhausted = exhaustedIds(pool)
        pool.active = orderedCredentials(pool).find((entry) => !exhausted.has(entry.id))?.id
          ?? firstCredentialId(pool)
      }
      if (Object.keys(pool.credentials).length === 0) {
        delete store.credentialPools?.[poolProvider]
      }
    })
    if (dir) {
      await rm(this.resolveCredentialPoolDir(dir), { recursive: true, force: true })
    }
    return this.listPoolCredentials(poolProvider)
  }

  async markPoolCredentialUsed(provider: AgentType, id: string): Promise<void> {
    const poolProvider = requireCredentialPoolProvider(provider)
    const credentialId = requireCredentialId(id)
    await this.mutate((store) => {
      const pool = getMutableCredentialPool(store, poolProvider)
      const credential = pool.credentials[credentialId]
      if (!credential) {
        throw new Error(`Credential "${credentialId}" is not registered for ${poolProvider}`)
      }
      pool.active = credentialId
      clearCredentialExhaustion(credential)
      pool.exhausted = pool.exhausted.filter((entry) => entry !== credentialId)
      credential.lastUsedAt = new Date().toISOString()
    })
  }

  resolveCredentialPoolCredentialDir(credential: CredentialPoolCredential): string {
    return this.resolveCredentialPoolDir(credential.dir)
  }

  private resolveCredentialPoolDir(relativeDir: string): string {
    const root = path.resolve(this.credentialPoolsRoot)
    const absolute = path.resolve(root, relativeDir)
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error('Credential pool directory escaped the configured root')
    }
    return absolute
  }

  private async buildPoolView(
    provider: CredentialPoolProvider,
    state: CredentialPoolState,
    options: { includeSecrets?: boolean } = {},
  ): Promise<CredentialPoolInternalView> {
    const pool = cloneCredentialPool(state)
    pruneExpiredCredentialExhaustion(pool)
    const exhausted = exhaustedIds(pool)
    const active = pool.active && pool.credentials[pool.active] ? pool.active : firstCredentialId(pool)
    const credentials = await Promise.all(orderedCredentials(pool).map(async (credential): Promise<CredentialPoolCredentialInternalView> => {
      const readiness = await readCredentialPoolCredentialReadiness(
        provider,
        this.resolveCredentialPoolCredentialDir(credential),
        credential.remoteToken,
      )
      const { remoteToken, remoteHomeKey, ...publicCredential } = credential
      const isExhausted = exhausted.has(credential.id)
      const isReady = readiness.readyLocal
      const isActive = credential.id === active
      const exhaustedUntil = resolveCredentialExhaustedUntil(credential)
      const status: CredentialPoolCredentialStatus = !isReady
        ? 'auth_required'
        : isExhausted
        ? 'exhausted'
        : isActive ? 'active' : 'available'
      return {
        ...publicCredential,
        ...(exhaustedUntil ? { exhaustedUntil } : {}),
        absoluteDir: this.resolveCredentialPoolCredentialDir(credential),
        active: isActive,
        exhausted: isExhausted,
        status,
        readiness,
        readyLocal: readiness.readyLocal,
        readyRemote: readiness.readyRemote,
        ...(remoteToken ? { remoteTokenPresent: true } : {}),
        ...(readiness.remoteTokenLength !== undefined ? { remoteTokenLength: readiness.remoteTokenLength } : {}),
        ...(options.includeSecrets && remoteToken ? { remoteToken } : {}),
        ...(options.includeSecrets && remoteHomeKey ? { remoteHomeKey } : {}),
      }
    }))
    const readyCredentials = credentials.filter(isReadyCredentialView)
    const nextCredential = readyCredentials.find((credential) => credential.id !== active)
    const earliestExhaustedUntil = earliestFutureIso(
      credentials.map((credential) => credential.exhaustedUntil),
    )
    return {
      provider,
      root: path.resolve(this.credentialPoolsRoot),
      ...(active ? { active } : {}),
      credentials,
      readyCount: readyCredentials.length,
      ...(nextCredential ? { nextCredential } : {}),
      ...(earliestExhaustedUntil ? { earliestExhaustedUntil } : {}),
    }
  }

  private async mutate(mutator: (store: PersistedProviderAuthStore) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const store = await this.read()
      mutator(store)
      await this.write(store)
    })
    this.queue = next.catch(() => undefined)
    await next
  }

  private async mutateAsync(mutator: (store: PersistedProviderAuthStore) => Promise<void> | void): Promise<void> {
    const next = this.queue.then(async () => {
      const store = await this.read()
      await mutator(store)
      await this.write(store)
    })
    this.queue = next.catch(() => undefined)
    await next
  }
}

function requireCredentialPoolProvider(provider: AgentType): CredentialPoolProvider {
  if (!isCredentialPoolProvider(provider)) {
    throw new Error(`${provider} does not support credential pools`)
  }
  return provider
}

function requireCredentialId(value: string): string {
  const id = normalizeCredentialId(value)
  if (!id) {
    throw new Error('Credential id is invalid')
  }
  return id
}

function getMutableCredentialPool(
  store: PersistedProviderAuthStore,
  provider: CredentialPoolProvider,
): CredentialPoolState {
  store.credentialPools ??= {}
  const pool = store.credentialPools[provider]
  if (!pool) {
    throw new Error(`No credential pool is configured for ${provider}`)
  }
  return pool
}

function providerHost(machine: MachineConfig | undefined): string {
  return machine?.id?.trim() || 'local'
}

export function resolveProviderAuthScopeId(creator: { id?: string; kind?: string } | undefined): string {
  const creatorId = creator?.id?.trim()
  if (creatorId) {
    return creatorId
  }
  return creator?.kind ? `${creator.kind}:default` : 'default'
}

export function buildProviderReauthUrl(provider: AgentType, scopeId: string, host: string): string {
  const params = new URLSearchParams({ scopeId, host })
  return `/api/agents/provider-auth/${encodeURIComponent(provider)}/reauth?${params.toString()}`
}

export function providerUsesManagedOAuth(_provider: AgentType): boolean {
  return false
}

export function buildProviderNativeAuthDetail(provider: AgentType, host: string): string | null {
  const target = host === 'local' ? 'the Herd host' : `machine "${host}"`
  if (provider === 'claude') {
    return `Claude Code uses native CLI authentication. Run \`claude auth status\` on ${target}; if it is not authenticated, run \`claude auth login\` there.`
  }
  if (provider === 'codex') {
    return `Codex uses native CLI authentication. Run \`codex login status\` on ${target}; if it is not authenticated, run \`codex login\` there.`
  }
  return null
}

function buildSnapshot(
  provider: AgentType,
  scopeId: string,
  host: string,
  status: ProviderAuthStatus,
  authMethod: ProviderAuthMethod,
  detail?: string,
  token?: ProviderTokenRecord,
): ProviderAuthSnapshot {
  return {
    provider,
    scopeId,
    host,
    status,
    lastCheckedAt: new Date().toISOString(),
    authMethod,
    ...(token?.accountId ? { accountId: token.accountId } : {}),
    ...(token?.email ? { accountEmail: token.email } : {}),
    ...(detail ? { detail } : {}),
    ...(status === 'auth_required' && providerUsesManagedOAuth(provider)
      ? { reauthUrl: buildProviderReauthUrl(provider, scopeId, host) }
      : {}),
  }
}

function buildPoolInstructions(
  provider: CredentialPoolProvider,
  absoluteDir: string,
): CredentialPoolInstructions {
  const quotedDir = shellQuote(absoluteDir)
  const login = buildCredentialPoolLoginCommand(provider, absoluteDir)
  return {
    directory: absoluteDir,
    commands: provider === 'claude'
      ? [
          `mkdir -p ${quotedDir}`,
          login.display,
        ]
      : [
          `mkdir -p ${quotedDir}`,
          login.display,
        ],
  }
}

function credentialPoolEnv(provider: CredentialPoolProvider, absoluteDir: string): NodeJS.ProcessEnv {
  return provider === 'claude'
    ? { CLAUDE_CONFIG_DIR: absoluteDir }
    : { CODEX_HOME: absoluteDir }
}

export function buildCredentialPoolLoginCommand(
  provider: CredentialPoolProvider,
  absoluteDir: string,
): CredentialPoolCommand {
  const env = credentialPoolEnv(provider, absoluteDir)
  const quotedDir = shellQuote(absoluteDir)
  return provider === 'claude'
    ? {
        command: 'claude',
        args: ['auth', 'login'],
        env,
        display: `CLAUDE_CONFIG_DIR=${quotedDir} claude auth login`,
      }
    : {
        command: 'codex',
        args: ['login', '--device-auth'],
        env,
        display: `CODEX_HOME=${quotedDir} codex login --device-auth`,
      }
}

export function buildClaudeCredentialPoolRemoteTokenCommand(absoluteDir: string): CredentialPoolCommand {
  const quotedDir = shellQuote(absoluteDir)
  return {
    command: 'claude',
    args: ['setup-token'],
    env: { CLAUDE_CONFIG_DIR: absoluteDir },
    display: `CLAUDE_CONFIG_DIR=${quotedDir} claude setup-token`,
  }
}

function isReadyCredentialView(credential: CredentialPoolCredentialView): boolean {
  return credential.status === 'active' || credential.status === 'available'
}

export function isReadyPoolCredentialForHost(
  provider: CredentialPoolProvider,
  credential: CredentialPoolCredentialView & { remoteToken?: string; remoteTokenPresent?: boolean },
  host: string,
): boolean {
  if (!isReadyCredentialView(credential)) {
    return false
  }
  return host === 'local' || provider !== 'claude' || Boolean(credential.remoteToken || credential.remoteTokenPresent)
}

export async function resolveReadyHostManagedPoolCredential(args: {
  provider: AgentType
  host: string
  store: Pick<ProviderAuthStore, 'listPoolCredentials'>
}): Promise<{ ready: true; credentialId: string } | { ready: false }> {
  if (!isCredentialPoolProvider(args.provider)) {
    return { ready: false }
  }
  const provider = args.provider
  const pool = await args.store.listPoolCredentials(provider)
  const credential = pool.credentials.find((candidate) => (
    candidate.id === pool.active && isReadyPoolCredentialForHost(provider, candidate, args.host)
  )) ?? pool.credentials.find((candidate) => isReadyPoolCredentialForHost(provider, candidate, args.host))
  return credential ? { ready: true, credentialId: credential.id } : { ready: false }
}

function isRemoteClaudePoolWithoutTokens(
  provider: CredentialPoolProvider,
  pool: CredentialPoolInternalView,
  host: string,
): boolean {
  return host !== 'local'
    && provider === 'claude'
    && pool.credentials.length > 0
    && pool.credentials.every((credential) => !credential.remoteToken)
}

function credentialPoolUnavailableDetail(
  provider: CredentialPoolProvider,
  credential: CredentialPoolCredentialInternalView,
  host: string,
): string {
  if (
    host !== 'local'
    && provider === 'claude'
    && isReadyCredentialView(credential)
    && !credential.remoteToken
  ) {
    return `Claude credential pool "${credential.label}" is missing its remote token. Complete the guided credential flow or run \`CLAUDE_CONFIG_DIR=${credential.absoluteDir} claude setup-token\` on the Herd host.`
  }
  return credential.status === 'exhausted'
    ? `Credential pool "${credential.label}" is cooling down${credential.exhaustedUntil ? ` until ${credential.exhaustedUntil}` : ''}.`
    : `${provider} credential pool "${credential.label}" is missing login auth. Re-run the provider login command for that credential directory.`
}

async function throwCredentialPoolUnavailable(args: {
  provider: CredentialPoolProvider
  scopeId: string
  host: string
  store: ProviderAuthStore
  credential: CredentialPoolCredentialInternalView
}): Promise<never> {
  const snapshot = buildSnapshot(
    args.provider,
    args.scopeId,
    args.host,
    'auth_required',
    'login',
    credentialPoolUnavailableDetail(args.provider, args.credential, args.host),
  )
  await args.store.upsertSnapshot(snapshot)
  throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
}

function noReadyPoolCredentialDetail(
  provider: CredentialPoolProvider,
  host: string,
  pool: CredentialPoolInternalView,
): string {
  if (pool.earliestExhaustedUntil) {
    return `No ${provider} credential pool credentials are ready. Earliest reset: ${pool.earliestExhaustedUntil}.`
  }
  if (host !== 'local' && provider === 'claude') {
    return 'No claude credential pool credentials are ready for remote spawn. Complete the guided credential flow to mint a remote token for a ready credential.'
  }
  return `No ${provider} credential pool credentials are ready. Re-run provider login for an auth_required credential.`
}

async function credentialPoolSpawnEnv(args: {
  provider: CredentialPoolProvider
  scopeId: string
  host: string
  store: ProviderAuthStore
  credential: CredentialPoolCredentialInternalView
  env: NodeJS.ProcessEnv
}): Promise<NodeJS.ProcessEnv> {
  if (args.host !== 'local') {
    if (args.provider === 'claude') {
      if (!args.credential.remoteToken) {
        await throwCredentialPoolUnavailable(args)
      }
      return { CLAUDE_CODE_OAUTH_TOKEN: args.credential.remoteToken }
    }

    const codexLoginEnv = await readCodexLoginAuthEnv({
      ...args.env,
      CODEX_HOME: args.credential.absoluteDir,
    }, 'local')
    if (!codexLoginEnv) {
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        args.host,
        'auth_required',
        'login',
        `Codex credential pool "${args.credential.label}" is missing login auth. Run \`CODEX_HOME=${args.credential.absoluteDir} codex login --device-auth\` on the Herd host.`,
      )
      await args.store.upsertSnapshot(snapshot)
      throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
    }
    return {
      ...codexLoginEnv,
      [HERD_CODEX_REMOTE_HOME_KEY]: credentialRemoteHomeKey(args.credential),
    }
  }

  const poolEnv = credentialPoolEnv(args.provider, args.credential.absoluteDir)
  if (args.provider === 'codex') {
    const codexLoginEnv = await readCodexLoginAuthEnv({ ...args.env, ...poolEnv }, args.host)
    if (!codexLoginEnv) {
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        args.host,
        'auth_required',
        'login',
        `Codex credential pool "${args.credential.label}" is missing login auth. Run \`CODEX_HOME=${args.credential.absoluteDir} codex login --device-auth\`.`,
      )
      await args.store.upsertSnapshot(snapshot)
      throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
    }
    return { ...poolEnv, ...codexLoginEnv }
  }

  if (!(await hasNonEmptyFile(path.join(args.credential.absoluteDir, '.credentials.json')))) {
    const snapshot = buildSnapshot(
      args.provider,
      args.scopeId,
      args.host,
      'auth_required',
      'login',
      `Claude credential pool "${args.credential.label}" is missing login auth. Run \`CLAUDE_CONFIG_DIR=${args.credential.absoluteDir} claude auth login\`.`,
    )
    await args.store.upsertSnapshot(snapshot)
    throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
  }
  return poolEnv
}

async function hasNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile() && fileStat.size > 0
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false
    }
    throw error
  }
}

export async function readCredentialPoolCredentialReadiness(
  provider: CredentialPoolProvider,
  absoluteDir: string,
  remoteToken?: string,
): Promise<CredentialPoolCredentialReadiness> {
  const local = provider === 'claude'
    ? (await hasNonEmptyFile(path.join(absoluteDir, '.credentials.json')) ? 'ready' : 'auth_required')
    : (await hasNonEmptyFile(path.join(absoluteDir, 'auth.json')) ? 'ready' : 'auth_required')
  const readyLocal = local === 'ready'
  const token = asTrimmedString(remoteToken)
  const remoteTokenPresent = Boolean(token)
  const remote = provider === 'claude'
    ? (readyLocal && remoteTokenPresent ? 'ready' : 'auth_required')
    : (readyLocal ? 'not_required' : 'auth_required')
  return {
    local,
    remote,
    readyLocal,
    readyRemote: remote === 'ready' || remote === 'not_required',
    remoteTokenPresent,
    ...(token ? { remoteTokenLength: token.length } : {}),
  }
}

function hasApiKeyAuth(provider: AgentType, env: NodeJS.ProcessEnv): boolean {
  if (provider === 'claude') {
    return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)
  }
  if (provider === 'codex') {
    return Boolean(env.OPENAI_API_KEY)
  }
  if (provider === 'gemini') {
    return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY)
  }
  if (provider === 'opencode') {
    return Boolean(env.OPENCODE_API_KEY)
  }
  return false
}

function resolveCodexHome(env: NodeJS.ProcessEnv): string {
  const configuredHome = env.CODEX_HOME?.trim()
  return path.resolve(configuredHome && configuredHome.length > 0
    ? configuredHome
    : path.join(env.HOME?.trim() || homedir(), '.codex'))
}

function normalizeCodexHome(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? path.resolve(trimmed) : undefined
}

async function codexStateHasThread(codexHome: string, threadId: string): Promise<boolean> {
  const dbPath = path.join(codexHome, 'state_5.sqlite')
  try {
    await access(dbPath)
  } catch {
    return false
  }

  let db: import('node:sqlite').DatabaseSync | null = null
  try {
    db = new nodeSqlite.DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare('SELECT 1 FROM threads WHERE id = ? LIMIT 1').get(threadId)
    return Boolean(row)
  } catch {
    return false
  } finally {
    db?.close()
  }
}

function addUniquePath(paths: string[], rawPath: string | undefined): void {
  const normalized = normalizeCodexHome(rawPath)
  if (!normalized || paths.includes(normalized)) {
    return
  }
  paths.push(normalized)
}

export async function findLocalCodexHomeForThread(args: {
  threadId: string
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
}): Promise<string | undefined> {
  const threadId = args.threadId.trim()
  if (!threadId) {
    return undefined
  }

  const env = args.env ?? process.env
  const candidates: string[] = []
  addUniquePath(candidates, resolveCodexHome(env))

  try {
    const pool = await args.store.listPoolCredentials('codex')
    for (const credential of pool.credentials) {
      addUniquePath(candidates, credential.absoluteDir)
    }
  } catch {
    // Credential pools are optional. Fall back to the host Codex home.
  }

  for (const codexHome of candidates) {
    if (await codexStateHasThread(codexHome, threadId)) {
      return codexHome
    }
  }

  return undefined
}

async function readCodexLoginAuthEnv(
  env: NodeJS.ProcessEnv,
  host: string,
): Promise<NodeJS.ProcessEnv | null> {
  if (host !== 'local') {
    return null
  }

  try {
    const authJson = (await readFile(path.join(resolveCodexHome(env), 'auth.json'), 'utf8')).trim()
    if (authJson.length === 0) {
      return null
    }
    const parsed = JSON.parse(authJson) as unknown
    if (!isObject(parsed)) {
      return null
    }
    const tokens = isObject(parsed.tokens) ? parsed.tokens : null
    const hasAuthMaterial = Boolean(
      asTrimmedString(parsed.OPENAI_API_KEY)
      || asTrimmedString(tokens?.access_token),
    )
    if (!hasAuthMaterial) {
      return null
    }
    return {
      [HERD_CODEX_AUTH_JSON_B64]: Buffer.from(authJson, 'utf8').toString('base64'),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

async function existingLoginAuthEnv(
  provider: AgentType,
  env: NodeJS.ProcessEnv,
  host: string,
): Promise<NodeJS.ProcessEnv | null> {
  if (provider === 'claude' && env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN }
  }
  if (provider === 'codex') {
    return readCodexLoginAuthEnv(env, host)
  }
  return null
}

function refreshTokenUrl(provider: AgentType, env: NodeJS.ProcessEnv): string {
  if (provider === 'codex') {
    return env.HERD_CODEX_OAUTH_TOKEN_URL?.trim() || CODEX_TOKEN_URL
  }
  throw new Error(`${provider} does not use Herd-managed OAuth tokens`)
}

function providerClientId(provider: AgentType): string {
  if (provider === 'codex') {
    return CODEX_CLIENT_ID
  }
  throw new Error(`${provider} does not use Herd-managed OAuth tokens`)
}

function tokenExpiresSoon(token: ProviderTokenRecord, nowMs: number): boolean {
  return token.expiresAt - nowMs < REFRESH_BUFFER_MS
}

interface RefreshResponse {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
  account_id?: unknown
  email?: unknown
}

async function refreshProviderToken(
  provider: AgentType,
  token: ProviderTokenRecord,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<ProviderTokenRecord> {
  if (!token.refresh) {
    throw new Error('Provider refresh token is missing')
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh,
    client_id: providerClientId(provider),
  })

  const response = await fetchImpl(refreshTokenUrl(provider, env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error(`Provider refresh failed with HTTP ${response.status}`)
  }
  const payload = await response.json() as RefreshResponse
  const access = asTrimmedString(payload.access_token)
  if (!access) {
    throw new Error('Provider refresh response did not include an access token')
  }
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : undefined
  const expiresAt = typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at)
    ? payload.expires_at
    : nowMs + ((expiresIn ?? 3600) * 1000)

  const refreshed: ProviderTokenRecord = {
    access,
    expiresAt,
    updatedAt: new Date(nowMs).toISOString(),
  }
  const refresh = asTrimmedString(payload.refresh_token) ?? token.refresh
  const idToken = asTrimmedString(payload.id_token) ?? token.idToken
  const accountId = asTrimmedString(payload.account_id) ?? token.accountId
  const email = asTrimmedString(payload.email) ?? token.email
  if (refresh) refreshed.refresh = refresh
  if (idToken) refreshed.idToken = idToken
  if (accountId) refreshed.accountId = accountId
  if (email) refreshed.email = email
  return refreshed
}

const refreshFlights = new Map<string, Promise<ProviderTokenRecord>>()

async function getValidToken(args: {
  provider: AgentType
  scopeId: string
  store: ProviderAuthStore
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  nowMs: number
}): Promise<ProviderTokenRecord | null> {
  const token = await args.store.getToken(args.provider, args.scopeId)
  if (!token) {
    return null
  }
  if (!tokenExpiresSoon(token, args.nowMs)) {
    return token
  }

  const key = `${args.provider}:${args.scopeId}`
  const existing = refreshFlights.get(key)
  if (existing) {
    return existing
  }
  const flight = refreshProviderToken(args.provider, token, args.env, args.fetchImpl, args.nowMs)
    .then(async (refreshed) => {
      await args.store.putToken(args.provider, args.scopeId, refreshed)
      return refreshed
    })
    .finally(() => {
      refreshFlights.delete(key)
    })
  refreshFlights.set(key, flight)
  return flight
}

export function buildCodexAuthJson(token: ProviderTokenRecord): Record<string, unknown> {
  return {
    OPENAI_API_KEY: null,
    tokens: {
      access_token: token.access,
      ...(token.refresh ? { refresh_token: token.refresh } : {}),
      ...(token.idToken ? { id_token: token.idToken } : {}),
      ...(token.accountId ? { account_id: token.accountId } : {}),
      ...(token.email ? { email: token.email } : {}),
      expires_at: token.expiresAt,
    },
    last_refresh: token.updatedAt ?? new Date().toISOString(),
  }
}

function envForProviderToken(provider: AgentType, token: ProviderTokenRecord): NodeJS.ProcessEnv {
  if (provider === 'codex') {
    return {
      [HERD_CODEX_AUTH_JSON_B64]: Buffer
        .from(JSON.stringify(buildCodexAuthJson(token)), 'utf8')
        .toString('base64'),
    }
  }
  return {}
}

export async function prepareProviderSpawnAuth(args: {
  provider: AgentType
  scopeId: string
  machine?: MachineConfig
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
  codexHome?: string
  credentialPoolId?: string
  fetchImpl?: typeof fetch
  nowMs?: number
  mode?: 'spawn' | 'probe'
}): Promise<ProviderSpawnAuth> {
  const env = args.env ?? process.env
  const fetchImpl = args.fetchImpl ?? fetch
  const nowMs = args.nowMs ?? Date.now()
  const mode = args.mode ?? 'spawn'
  const host = providerHost(args.machine)
  const codexHome = args.provider === 'codex' && host === 'local'
    ? normalizeCodexHome(args.codexHome)
    : undefined
  const baseEnv = codexHome ? { ...env, CODEX_HOME: codexHome } : env
  const requestedPoolCredential = isCredentialPoolProvider(args.provider) && args.credentialPoolId
    ? await args.store.getPoolCredentialForSpawn(args.provider, args.credentialPoolId)
    : null
  if (isCredentialPoolProvider(args.provider) && args.credentialPoolId && !requestedPoolCredential) {
    const snapshot = buildSnapshot(
      args.provider,
      args.scopeId,
      host,
      'auth_required',
      'login',
      `Persisted ${args.provider} credential pool "${args.credentialPoolId}" is not registered. Restore the credential or migrate the session before resuming.`,
    )
    await args.store.upsertSnapshot(snapshot)
    throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
  }

  if (codexHome) {
    if (requestedPoolCredential && normalizeCodexHome(requestedPoolCredential.absoluteDir) !== codexHome) {
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'auth_required',
        'login',
        `Persisted codexHome "${codexHome}" does not match credential pool "${requestedPoolCredential.id}". Run the one-off Herd migration before resuming.`,
      )
      await args.store.upsertSnapshot(snapshot)
      throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
    }
    const loginEnv = await readCodexLoginAuthEnv(baseEnv, host)
    if (loginEnv) {
      if (requestedPoolCredential && !isReadyCredentialView(requestedPoolCredential)) {
        await throwCredentialPoolUnavailable({
          provider: 'codex',
          scopeId: args.scopeId,
          host,
          store: args.store,
          credential: requestedPoolCredential,
        })
      }
      if (requestedPoolCredential && mode !== 'probe') {
        await args.store.markPoolCredentialUsed(args.provider, requestedPoolCredential.id)
      }
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'ready',
        'login',
        'Using Codex CLI credentials from the persisted thread home.',
      )
      await args.store.upsertSnapshot(snapshot)
      return {
        provider: args.provider,
        snapshot,
        env: { CODEX_HOME: codexHome, ...loginEnv },
        ...(requestedPoolCredential ? { credentialPoolId: requestedPoolCredential.id } : {}),
      }
    }
    if (requestedPoolCredential) {
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'auth_required',
        'login',
        `Codex credential pool "${requestedPoolCredential.label}" is missing login auth. Run \`CODEX_HOME=${requestedPoolCredential.absoluteDir} codex login --device-auth\`.`,
      )
      await args.store.upsertSnapshot(snapshot)
      throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
    }
  }

  if (isCredentialPoolProvider(args.provider) && !codexHome) {
    const poolProvider = args.provider
    const pool = await args.store.listPoolCredentialsForSpawn(poolProvider)
    const requestedReady = requestedPoolCredential
      ? isReadyPoolCredentialForHost(poolProvider, requestedPoolCredential, host)
      : false
    if (requestedPoolCredential && !requestedReady) {
      await throwCredentialPoolUnavailable({
        provider: poolProvider,
        scopeId: args.scopeId,
        host,
        store: args.store,
        credential: requestedPoolCredential,
      })
    }
    const usePool = Boolean(requestedPoolCredential) || !isRemoteClaudePoolWithoutTokens(poolProvider, pool, host)
    if (usePool) {
      const fallbackCredential = pool.credentials.find((candidate) => candidate.id === pool.active && isReadyPoolCredentialForHost(poolProvider, candidate, host))
        ?? pool.credentials.find((candidate) => isReadyPoolCredentialForHost(poolProvider, candidate, host))
        ?? null
      const credential = requestedPoolCredential
        ? requestedPoolCredential
        : fallbackCredential
      if (requestedPoolCredential && !credential) {
        await throwCredentialPoolUnavailable({
          provider: poolProvider,
          scopeId: args.scopeId,
          host,
          store: args.store,
          credential: requestedPoolCredential,
        })
      }
      if (!credential && pool.credentials.length > 0) {
        const snapshot = buildSnapshot(
          args.provider,
          args.scopeId,
          host,
          'auth_required',
          'login',
          noReadyPoolCredentialDetail(poolProvider, host, pool),
        )
        await args.store.upsertSnapshot(snapshot)
        throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
      }
      if (credential) {
        const spawnEnv = await credentialPoolSpawnEnv({
          provider: poolProvider,
          scopeId: args.scopeId,
          host,
          store: args.store,
          credential,
          env,
        })
        if (mode !== 'probe' && host === 'local') {
          await args.store.markPoolCredentialUsed(poolProvider, credential.id)
        }
        const snapshot = buildSnapshot(
          args.provider,
          args.scopeId,
          host,
          'ready',
          'login',
          `Using ${args.provider} credential pool "${credential.label}".`,
          credential.email ? {
            access: 'credential-pool',
            expiresAt: Number.MAX_SAFE_INTEGER,
            email: credential.email,
          } : undefined,
        )
        await args.store.upsertSnapshot(snapshot)
        return {
          provider: args.provider,
          snapshot,
          env: spawnEnv,
          credentialPoolId: credential.id,
        }
      }
    }
  }

  if (!providerUsesManagedOAuth(args.provider)) {
    if (args.provider === 'claude') {
      if (hasApiKeyAuth(args.provider, baseEnv)) {
        const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'api-key')
        await args.store.upsertSnapshot(snapshot)
        return { provider: args.provider, snapshot }
      }
      const loginEnv = await existingLoginAuthEnv(args.provider, baseEnv, host)
      if (loginEnv) {
        const snapshot = buildSnapshot(
          args.provider,
          args.scopeId,
          host,
          'ready',
          'login',
          'Using Claude Code CLI credentials from the target environment.',
        )
        await args.store.upsertSnapshot(snapshot)
        return { provider: args.provider, snapshot, env: loginEnv }
      }
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'unknown',
        'login',
        buildProviderNativeAuthDetail(args.provider, host) ?? undefined,
      )
      await args.store.upsertSnapshot(snapshot)
      return { provider: args.provider, snapshot }
    }

    if (args.provider === 'codex') {
      if (hasApiKeyAuth(args.provider, baseEnv)) {
        const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'api-key')
        await args.store.upsertSnapshot(snapshot)
        return {
          provider: args.provider,
          snapshot,
          ...(codexHome ? { env: { CODEX_HOME: codexHome } } : {}),
        }
      }
      const loginEnv = await existingLoginAuthEnv(args.provider, baseEnv, host)
      if (loginEnv) {
        const snapshot = buildSnapshot(
          args.provider,
          args.scopeId,
          host,
          'ready',
          'login',
          'Using Codex CLI credentials from the target environment.',
        )
        await args.store.upsertSnapshot(snapshot)
        return {
          provider: args.provider,
          snapshot,
          env: codexHome ? { CODEX_HOME: codexHome, ...loginEnv } : loginEnv,
        }
      }
      const detail = codexHome
        ? `Codex thread home "${codexHome}" has no login auth and OPENAI_API_KEY is not set. Run \`CODEX_HOME=${codexHome} codex login --device-auth\` or provide OPENAI_API_KEY.`
        : buildProviderNativeAuthDetail(args.provider, host) ?? undefined
      const status: ProviderAuthStatus = host === 'local' ? 'auth_required' : 'unknown'
      const snapshot = buildSnapshot(args.provider, args.scopeId, host, status, 'login', detail)
      await args.store.upsertSnapshot(snapshot)
      if (status === 'auth_required') {
        throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
      }
      return { provider: args.provider, snapshot }
    }

    const status = hasApiKeyAuth(args.provider, env) ? 'ready' : 'unknown'
    const detail = status === 'unknown'
      ? `${args.provider} uses API-key auth in Herd today; no OAuth refresh adapter is available.`
      : undefined
    const snapshot = buildSnapshot(args.provider, args.scopeId, host, status, status === 'ready' ? 'api-key' : 'missing', detail)
    await args.store.upsertSnapshot(snapshot)
    return { provider: args.provider, snapshot }
  }

  if (hasApiKeyAuth(args.provider, baseEnv)) {
    const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'api-key')
    await args.store.upsertSnapshot(snapshot)
    return { provider: args.provider, snapshot }
  }

  let token: ProviderTokenRecord | null = null
  try {
    token = await getValidToken({
      provider: args.provider,
      scopeId: args.scopeId,
      store: args.store,
      env: baseEnv,
      fetchImpl,
      nowMs,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'auth_required', 'oauth', detail)
    await args.store.upsertSnapshot(snapshot)
    throw new ProviderAuthRequiredError(args.provider, snapshot, detail)
  }

  if (!token) {
    const loginEnv = await existingLoginAuthEnv(args.provider, baseEnv, host)
    if (loginEnv) {
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'ready',
        'login',
        'Using existing host login credentials; re-auth in Herd to enable managed refresh.',
      )
      await args.store.upsertSnapshot(snapshot)
      return { provider: args.provider, snapshot, env: loginEnv }
    }

    const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'auth_required', 'missing', 'No Herd-managed provider token is stored.')
    await args.store.upsertSnapshot(snapshot)
    throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
  }

  const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'oauth', undefined, token)
  await args.store.upsertSnapshot(snapshot)
  return {
    provider: args.provider,
    snapshot,
    env: envForProviderToken(args.provider, token),
  }
}

export function mergeProviderSpawnAuthIntoLaunch(
  prepared: PreparedMachineLaunchEnvironment,
  providerAuth: ProviderSpawnAuth | undefined,
  machine?: MachineConfig,
): PreparedMachineLaunchEnvironment {
  const entries = providerAuth?.env
  if (!entries || Object.keys(entries).length === 0) {
    return prepared
  }
  if (machine?.host) {
    const env: NodeJS.ProcessEnv = { ...prepared.env }
    const sshSendEnvKeys = [...prepared.sshSendEnvKeys]
    let index = sshSendEnvKeys
      .map((key) => key.startsWith(HERD_MACHINE_ENV_PREFIX)
        ? Number.parseInt(key.slice(HERD_MACHINE_ENV_PREFIX.length), 10)
        : -1)
      .filter(Number.isFinite)
      .reduce((max, current) => Math.max(max, current), -1) + 1
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) {
        continue
      }
      const transportKey = `${HERD_MACHINE_ENV_PREFIX}${String(index).padStart(4, '0')}`
      env[transportKey] = `${key}=${value}`
      sshSendEnvKeys.push(transportKey)
      index += 1
    }
    return { ...prepared, env, sshSendEnvKeys }
  }
  return { ...prepared, env: { ...prepared.env, ...entries } }
}

export function isProviderAuthRequiredText(text: string): boolean {
  return [
    /\b(?:invalid_grant|expired_token|invalid_token)\b/iu,
    /\b(?:not logged in|login required)\b/iu,
    /\b(?:authentication|authorization)\s+(?:required|failed|expired)\b/iu,
    /\boauth\b[^\n.]{0,80}\bexpired\b/iu,
    /\btoken\b[^\n.]{0,80}\bexpired\b/iu,
    /\b(?:http\/\d(?:\.\d)?\s*)?401\b[^\n.]{0,80}\b(?:unauthorized|authentication|authorization|auth|token|oauth|login)\b/iu,
    /\b(?:unauthorized|authentication|authorization|auth|token|oauth|login)\b[^\n.]{0,80}\b(?:http\s*)?401\b/iu,
  ].some((pattern) => pattern.test(text))
}

function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function codeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function authorizeUrl(provider: AgentType, env: NodeJS.ProcessEnv): string {
  if (provider === 'codex') {
    return env.HERD_CODEX_OAUTH_AUTHORIZE_URL?.trim() || CODEX_AUTHORIZE_URL
  }
  throw new Error(`${provider} does not use Herd-managed OAuth tokens`)
}

function redirectPort(provider: AgentType): number {
  if (provider === 'codex') {
    return CODEX_REDIRECT_PORT
  }
  throw new Error(`${provider} does not use Herd-managed OAuth tokens`)
}

export async function startProviderOAuthFlow(args: {
  provider: AgentType
  scopeId: string
  host: string
  store: ProviderAuthStore
  callbackUrl?: string
  env?: NodeJS.ProcessEnv
  nowMs?: number
}): Promise<ProviderOAuthStartResult> {
  if (!providerUsesManagedOAuth(args.provider)) {
    const nativeDetail = buildProviderNativeAuthDetail(args.provider, args.host)
    throw new Error(nativeDetail ?? `${args.provider} does not expose a Herd OAuth flow`)
  }
  const env = args.env ?? process.env
  const nowMs = args.nowMs ?? Date.now()
  const state = randomUrlSafe(24)
  const verifier = randomUrlSafe(48)
  const challenge = codeChallenge(verifier)
  const redirectUri = args.callbackUrl?.trim() || `http://127.0.0.1:${redirectPort(args.provider)}/callback`
  const parsedRedirectUri = new URL(redirectUri)
  if (parsedRedirectUri.protocol !== 'http:' && parsedRedirectUri.protocol !== 'https:') {
    throw new Error('Provider OAuth callback URL must use http or https')
  }
  const expiresAt = new Date(nowMs + (5 * 60_000)).toISOString()
  const authorizationUrl = new URL(authorizeUrl(args.provider, env))
  authorizationUrl.searchParams.set('client_id', providerClientId(args.provider))
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('code_challenge', challenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  authorizationUrl.searchParams.set('state', state)
  if (args.provider === 'codex') {
    authorizationUrl.searchParams.set('scope', 'openid profile email offline_access')
  }

  await args.store.createOAuthFlow({
    provider: args.provider,
    scopeId: args.scopeId,
    host: args.host,
    state,
    codeVerifier: verifier,
    codeChallenge: challenge,
    redirectUri,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt,
  })

  return {
    provider: args.provider,
    scopeId: args.scopeId,
    host: args.host,
    state,
    authorizationUrl: authorizationUrl.toString(),
    callbackUrl: redirectUri,
    expiresAt,
  }
}

export async function completeProviderOAuthFlow(args: {
  state: string
  code: string
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  nowMs?: number
}): Promise<ProviderOAuthCompleteResult> {
  const flow = await args.store.consumeOAuthFlow(args.state)
  if (!flow) {
    throw new Error('OAuth flow is missing or expired')
  }
  if (!providerUsesManagedOAuth(flow.provider)) {
    const nativeDetail = buildProviderNativeAuthDetail(flow.provider, flow.host)
    throw new Error(nativeDetail ?? `${flow.provider} does not expose a Herd OAuth flow`)
  }
  const env = args.env ?? process.env
  const fetchImpl = args.fetchImpl ?? fetch
  const nowMs = args.nowMs ?? Date.now()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: providerClientId(flow.provider),
    redirect_uri: flow.redirectUri,
    code_verifier: flow.codeVerifier,
  })
  const response = await fetchImpl(refreshTokenUrl(flow.provider, env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${response.status}`)
  }
  const payload = await response.json() as RefreshResponse
  const access = asTrimmedString(payload.access_token)
  if (!access) {
    throw new Error('OAuth token exchange response did not include an access token')
  }
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : 3600
  const token: ProviderTokenRecord = {
    access,
    expiresAt: nowMs + (expiresIn * 1000),
    updatedAt: new Date(nowMs).toISOString(),
  }
  const refresh = asTrimmedString(payload.refresh_token)
  const idToken = asTrimmedString(payload.id_token)
  const accountId = asTrimmedString(payload.account_id)
  const email = asTrimmedString(payload.email)
  if (refresh) token.refresh = refresh
  if (idToken) token.idToken = idToken
  if (accountId) token.accountId = accountId
  if (email) token.email = email
  await args.store.putToken(flow.provider, flow.scopeId, token)
  const snapshot = buildSnapshot(flow.provider, flow.scopeId, flow.host, 'ready', 'oauth', undefined, token)
  await args.store.upsertSnapshot(snapshot)
  return {
    provider: flow.provider,
    scopeId: flow.scopeId,
    host: flow.host,
    token,
    snapshot,
  }
}

const oauthCallbackServers = new Map<number, Server>()
const oauthCallbackServerStarts = new Map<number, Promise<void>>()
const oauthCallbackCompleteHandlers = new Map<number, (result: ProviderOAuthCompleteResult) => Promise<void> | void>()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sendOAuthCallbackHtml(
  res: ServerResponse,
  statusCode: number,
  title: string,
  message: string,
): void {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`)
}

async function handleOAuthCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  args: {
    port: number
    store: ProviderAuthStore
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
  },
): Promise<void> {
  if (req.method !== 'GET' || !req.url) {
    sendOAuthCallbackHtml(res, 404, 'Not found', 'Provider OAuth callback not found.')
    return
  }

  const callbackUrl = new URL(req.url, 'http://127.0.0.1')
  if (callbackUrl.pathname !== '/callback') {
    sendOAuthCallbackHtml(res, 404, 'Not found', 'Provider OAuth callback not found.')
    return
  }

  const state = callbackUrl.searchParams.get('state')?.trim() ?? ''
  const code = callbackUrl.searchParams.get('code')?.trim() ?? ''
  if (!state || !code) {
    sendOAuthCallbackHtml(res, 400, 'Re-auth failed', 'OAuth callback is missing state or code.')
    return
  }

  try {
    const result = await completeProviderOAuthFlow({
      state,
      code,
      store: args.store,
      env: args.env,
      fetchImpl: args.fetchImpl,
    })
    await oauthCallbackCompleteHandlers.get(args.port)?.(result)
    sendOAuthCallbackHtml(
      res,
      200,
      'Re-auth complete',
      'Provider authentication is ready. You can close this tab and return to Herd.',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth token exchange failed.'
    sendOAuthCallbackHtml(res, 400, 'Re-auth failed', message)
  }
}

export async function ensureProviderOAuthCallbackServer(args: {
  provider: AgentType
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  onComplete?: (result: ProviderOAuthCompleteResult) => Promise<void> | void
}): Promise<void> {
  if (!providerUsesManagedOAuth(args.provider)) {
    return
  }

  const port = redirectPort(args.provider)
  if (args.onComplete) {
    oauthCallbackCompleteHandlers.set(port, args.onComplete)
  }
  if (oauthCallbackServers.has(port)) {
    return
  }
  const existingStart = oauthCallbackServerStarts.get(port)
  if (existingStart) {
    await existingStart
    return
  }

  const server = createServer((req, res) => {
    void handleOAuthCallbackRequest(req, res, { ...args, port })
  })
  const start = new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      server.unref?.()
      oauthCallbackServers.set(port, server)
      resolve()
    })
  }).finally(() => {
    oauthCallbackServerStarts.delete(port)
  })

  oauthCallbackServerStarts.set(port, start)
  server.once('close', () => {
    oauthCallbackServers.delete(port)
    oauthCallbackCompleteHandlers.delete(port)
  })
  await start
}

export async function closeProviderOAuthCallbackServers(): Promise<void> {
  const servers = [...oauthCallbackServers.values()]
  oauthCallbackServers.clear()
  oauthCallbackCompleteHandlers.clear()
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
}
