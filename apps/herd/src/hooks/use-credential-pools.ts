import { useContext } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type { AgentType } from '@/types'

const fallbackQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

export type CredentialPoolProvider = 'claude' | 'codex'
export type CredentialPoolCredentialStatus = 'active' | 'available' | 'exhausted' | 'auth_required'
export type ClaudeQuotaEligibility = 'ready' | 'near_limit' | 'blocked_5h' | 'blocked_weekly' | 'unknown'
export type ClaudeQuotaFetchStatus = 'fresh' | 'cached' | 'rate_limited' | 'failed' | 'auth_required' | 'never'
export type ClaudeQuotaWindowKind = 'five_hour' | 'seven_day' | 'weekly_scoped'

export interface CredentialPoolReadinessDto {
  local: 'ready' | 'auth_required' | 'unknown'
  remote: 'ready' | 'auth_required' | 'not_required'
  readyLocal: boolean
  readyRemote: boolean
  remoteTokenPresent: boolean
  remoteTokenLength?: number
}

export interface ClaudeQuotaWindowDto {
  kind: ClaudeQuotaWindowKind
  label: string
  utilizationPct: number
  resetsAt?: string
  scope?: string
}

export interface ClaudeCredentialQuotaDto {
  fetchStatus: ClaudeQuotaFetchStatus
  fetchedAt?: string
  nextRefreshAt?: string
  windows: ClaudeQuotaWindowDto[]
  errorCode?: string
}

export interface CredentialPoolLiveSessionDto {
  name: string
  host: string
}

export interface CredentialPoolRotationEventDto {
  type: 'recovered' | 'blocked'
  at: string
  provider: CredentialPoolProvider
  sessionName: string
  previousCredentialId?: string
  previousCredentialLabel?: string
  activeCredentialId?: string
  activeCredentialLabel?: string
}

export interface CredentialPoolCredentialDto {
  id: string
  label: string
  email?: string
  absoluteDir?: string
  active: boolean
  globalActive?: boolean
  exhausted: boolean
  exhaustedUntil?: string
  status: CredentialPoolCredentialStatus
  readiness?: CredentialPoolReadinessDto
  readyLocal?: boolean
  readyRemote?: boolean
  remoteTokenPresent?: boolean
  remoteTokenLength?: number
  authBrokenAt?: string
  authBrokenReason?: string
  lastUsedAt?: string
  liveSessionCount?: number
  liveSessions?: CredentialPoolLiveSessionDto[]
  latestRotationEvent?: CredentialPoolRotationEventDto
  quotaEligibility?: ClaudeQuotaEligibility
  quota?: ClaudeCredentialQuotaDto
}

export interface CredentialPoolDto {
  provider: CredentialPoolProvider
  active?: string
  globalActive?: string
  generatedAt?: string
  quotaRefreshIntervalMs?: number
  credentials: CredentialPoolCredentialDto[]
  nextCredential?: CredentialPoolCredentialDto
  readyCount?: number
  earliestExhaustedUntil?: string
  latestRotationEvent?: CredentialPoolRotationEventDto
}

export function isCredentialPoolProvider(
  provider: AgentType | string | null | undefined,
): provider is CredentialPoolProvider {
  return provider === 'claude' || provider === 'codex'
}

export function credentialPoolQueryKey(provider: CredentialPoolProvider): readonly string[] {
  return ['agents', 'provider-auth', 'pool', provider]
}

export function fetchCredentialPool(provider: CredentialPoolProvider): Promise<CredentialPoolDto> {
  return fetchJson<CredentialPoolDto>(`/api/agents/provider-auth/pool/${provider}`)
}

export function activateClaudeCredential(credentialId: string): Promise<CredentialPoolDto> {
  return fetchJson<CredentialPoolDto>('/api/agents/provider-auth/pool/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'claude', credentialId }),
  })
}

export function refreshClaudeCredentialQuota(credentialId?: string): Promise<CredentialPoolDto> {
  return fetchJson<CredentialPoolDto>('/api/agents/provider-auth/pool/quota/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'claude',
      ...(credentialId ? { credentialId } : {}),
    }),
  })
}

export function useCredentialPool(provider: AgentType | null | undefined) {
  const queryClient = useContext(QueryClientContext)
  const hasQueryClient = queryClient !== undefined
  const activeQueryClient = queryClient ?? fallbackQueryClient
  const poolProvider = isCredentialPoolProvider(provider) ? provider : null

  return useQuery({
    queryKey: poolProvider
      ? credentialPoolQueryKey(poolProvider)
      : ['agents', 'provider-auth', 'pool', null],
    queryFn: () => fetchCredentialPool(poolProvider!),
    enabled: hasQueryClient && poolProvider !== null,
    staleTime: poolProvider === 'claude' ? 10_000 : 30_000,
    refetchInterval: poolProvider === 'claude' ? 15_000 : false,
    refetchIntervalInBackground: false,
  }, activeQueryClient)
}

export function effectiveClaudeQuotaFetchStatus(
  quota: ClaudeCredentialQuotaDto | undefined,
  nowMs = Date.now(),
): ClaudeQuotaFetchStatus {
  const status = quota?.fetchStatus ?? 'never'
  if (status !== 'fresh' || !quota?.nextRefreshAt) {
    return status
  }
  const refreshAt = Date.parse(quota.nextRefreshAt)
  return Number.isFinite(refreshAt) && refreshAt <= nowMs ? 'cached' : status
}

export function isCredentialPoolCredentialSelectable(
  provider: CredentialPoolProvider,
  credential: CredentialPoolCredentialDto,
  host: string | null | undefined = 'local',
): boolean {
  if (credential.status !== 'active' && credential.status !== 'available') {
    return false
  }
  if (provider === 'claude' && host && host !== 'local') {
    return credential.readiness?.readyRemote ?? credential.readyRemote ?? false
  }
  return credential.readiness?.readyLocal ?? credential.readyLocal ?? true
}

function formatCooldown(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function credentialPoolCredentialStatusLabel(
  provider: CredentialPoolProvider,
  credential: CredentialPoolCredentialDto,
  host: string | null | undefined = 'local',
): string {
  if (credential.status === 'auth_required') {
    return 'auth required'
  }
  if (credential.status === 'exhausted') {
    return credential.exhaustedUntil
      ? `cooling until ${formatCooldown(credential.exhaustedUntil)}`
      : 'exhausted'
  }
  if (
    provider === 'claude'
    && host
    && host !== 'local'
    && !(credential.readiness?.readyRemote ?? credential.readyRemote)
  ) {
    return 'remote auth required'
  }
  return credential.status
}

export function credentialPoolCredentialOptionLabel(
  provider: CredentialPoolProvider,
  credential: CredentialPoolCredentialDto,
  host: string | null | undefined = 'local',
): string {
  const identity = credential.email
    ? `${credential.label} · ${credential.email}`
    : credential.label
  const fiveHour = provider === 'claude'
    && effectiveClaudeQuotaFetchStatus(credential.quota) === 'fresh'
    ? credential.quota?.windows.find((window) => window.kind === 'five_hour')
    : undefined
  const fetchStatus = provider === 'claude'
    ? effectiveClaudeQuotaFetchStatus(credential.quota)
    : undefined
  const quota = fiveHour && Number.isFinite(fiveHour.utilizationPct)
    ? ` · 5h ${Math.round(Math.max(0, Math.min(100, fiveHour.utilizationPct)))}%`
    : fetchStatus && fetchStatus !== 'fresh'
      ? ` · quota ${fetchStatus.replace('_', ' ')}`
      : ''
  return `${identity} · ${credentialPoolCredentialStatusLabel(provider, credential, host)}${quota}`
}
