import { FormEvent, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  activateClaudeCredential,
  credentialPoolQueryKey,
  effectiveClaudeQuotaFetchStatus,
  fetchCredentialPool,
  refreshClaudeCredentialQuota,
  type ClaudeCredentialQuotaDto,
  type ClaudeQuotaFetchStatus,
  type ClaudeQuotaWindowDto,
  type CredentialPoolCredentialDto,
  type CredentialPoolDto,
  type CredentialPoolProvider,
  type CredentialPoolReadinessDto,
  type CredentialPoolRotationEventDto,
} from '@/hooks/use-credential-pools'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

export { credentialPoolQueryKey, fetchCredentialPool }
export type { CredentialPoolProvider }

type CredentialLoginFlowStatus = 'starting' | 'running' | 'ready_local' | 'ready_remote' | 'exited' | 'failed'
type RemoteTokenMintStatus = 'not_required' | 'waiting_for_login' | 'minting' | 'stored' | 'failed'

interface CredentialPoolRegisterResponse {
  credential: CredentialPoolCredentialDto
  pool: CredentialPoolDto
  instructions: {
    directory: string
    commands: string[]
  }
}

interface CredentialPoolRemoteTokenResponse {
  credential: CredentialPoolCredentialDto
  pool: CredentialPoolDto
}

interface CredentialLoginFlowDto {
  id: string
  provider: CredentialPoolProvider
  credentialId: string
  command: string
  startedAt: string
  updatedAt: string
  status: CredentialLoginFlowStatus
  transcript: string
  readiness: CredentialPoolReadinessDto
  remoteToken: {
    status: RemoteTokenMintStatus
    tokenLength?: number
    error?: string
  }
  pid?: number
  exitCode?: number
  signal?: number | string
  error?: string
}

type CredentialPoolsPanelSurface = 'mobile' | 'desktop'

const CREDENTIAL_POOL_PROVIDER_IDS: readonly CredentialPoolProvider[] = ['claude', 'codex']
const CREDENTIAL_POOL_LABELS: Record<CredentialPoolProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

function startCredentialLoginFlow(
  provider: CredentialPoolProvider,
  credentialId: string,
): Promise<CredentialLoginFlowDto> {
  return fetchJson<CredentialLoginFlowDto>(
    `/api/agents/provider-auth/pool/credentials/${provider}/${encodeURIComponent(credentialId)}/login-flow`,
    { method: 'POST' },
  )
}

function fetchCredentialLoginFlow(
  flow: Pick<CredentialLoginFlowDto, 'provider' | 'credentialId' | 'id'>,
): Promise<CredentialLoginFlowDto> {
  return fetchJson<CredentialLoginFlowDto>(
    `/api/agents/provider-auth/pool/credentials/${flow.provider}/${encodeURIComponent(flow.credentialId)}/login-flow/${encodeURIComponent(flow.id)}`,
  )
}

function finalizeCredentialLoginFlow(flow: CredentialLoginFlowDto): Promise<CredentialLoginFlowDto> {
  return fetchJson<CredentialLoginFlowDto>(
    `/api/agents/provider-auth/pool/credentials/${flow.provider}/${encodeURIComponent(flow.credentialId)}/login-flow/${encodeURIComponent(flow.id)}/finalize`,
    { method: 'POST' },
  )
}

function submitCredentialLoginFlowInput(
  flow: Pick<CredentialLoginFlowDto, 'provider' | 'credentialId' | 'id'>,
  input: string,
): Promise<CredentialLoginFlowDto> {
  return fetchJson<CredentialLoginFlowDto>(
    `/api/agents/provider-auth/pool/credentials/${flow.provider}/${encodeURIComponent(flow.credentialId)}/login-flow/${encodeURIComponent(flow.id)}/input`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    },
  )
}

function submitCredentialRemoteToken(
  provider: CredentialPoolProvider,
  credentialId: string,
  token: string,
): Promise<CredentialPoolRemoteTokenResponse> {
  return fetchJson<CredentialPoolRemoteTokenResponse>(
    `/api/agents/provider-auth/pool/credentials/${provider}/${encodeURIComponent(credentialId)}/remote-token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    },
  )
}

function defaultCredentialLabel(provider: CredentialPoolProvider, count: number): string {
  return `${CREDENTIAL_POOL_LABELS[provider]} ${count + 1}`
}

function credentialStatusLabel(
  provider: CredentialPoolProvider,
  credential: CredentialPoolCredentialDto,
): string {
  if (credential.status === 'auth_required') {
    return 'auth required'
  }
  if (provider === 'claude') {
    if (credential.exhausted) {
      return credential.exhaustedUntil ? 'cooling down' : 'exhausted'
    }
    return credentialReadyLocal(credential) ? 'available' : 'auth required'
  }
  if (credential.active && credential.exhausted) {
    return 'active, exhausted'
  }
  if (credential.active) {
    return 'active'
  }
  if (credential.exhausted) {
    return credential.exhaustedUntil ? 'cooling down' : 'exhausted'
  }
  return credential.status
}

function credentialReadyLocal(credential: CredentialPoolCredentialDto): boolean {
  return credential.readiness?.readyLocal ?? credential.readyLocal ?? credential.status !== 'auth_required'
}

function credentialReadyRemote(credential: CredentialPoolCredentialDto): boolean {
  return credential.readiness?.readyRemote ?? credential.readyRemote ?? credentialReadyLocal(credential)
}

function credentialReadinessLabel(credential: CredentialPoolCredentialDto): string {
  const readyLocal = credentialReadyLocal(credential)
  const readyRemote = credentialReadyRemote(credential)
  if (readyLocal && credential.readiness?.remote === 'not_required') {
    return 'ready-local · remote not required'
  }
  if (readyLocal && readyRemote) {
    return 'ready-local · ready-remote'
  }
  if (readyLocal) {
    return 'ready-local · remote missing'
  }
  return 'local auth required'
}

function formatCredentialTimestamp(value?: string): string {
  if (!value) {
    return 'never'
  }
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

function formatQuotaTimestamp(value?: string): string {
  if (!value) {
    return 'unknown'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function formatResetCountdown(value?: string): string {
  if (!value) {
    return 'at an unknown time'
  }
  const resetAt = Date.parse(value)
  if (!Number.isFinite(resetAt)) {
    return `at ${value}`
  }
  const remainingMinutes = Math.ceil((resetAt - Date.now()) / 60_000)
  if (remainingMinutes <= 0) {
    return 'due now'
  }
  if (remainingMinutes < 60) {
    return `in ${remainingMinutes}m`
  }
  const remainingHours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  if (remainingHours < 24) {
    return `in ${remainingHours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  }
  const days = Math.floor(remainingHours / 24)
  const hours = remainingHours % 24
  return `in ${days}d${hours > 0 ? ` ${hours}h` : ''}`
}

function quotaFetchStatusLabel(status: ClaudeQuotaFetchStatus): string {
  switch (status) {
    case 'fresh':
      return 'fresh'
    case 'cached':
      return 'cached'
    case 'rate_limited':
      return 'refresh throttled'
    case 'failed':
      return 'refresh failed'
    case 'auth_required':
      return 'auth required'
    case 'never':
      return 'not fetched'
  }
}

function quotaFetchStatusClassName(status: ClaudeQuotaFetchStatus): string {
  if (status === 'fresh') {
    return 'border-[color:var(--hv-accent-success)] text-[color:var(--hv-accent-success)]'
  }
  if (status === 'cached' || status === 'rate_limited') {
    return 'border-[color:var(--hv-accent-warning)] text-[color:var(--hv-accent-warning)]'
  }
  return 'border-[color:var(--hv-accent-danger)] text-[color:var(--hv-accent-danger)]'
}

function quotaUnavailableLabel(quota?: ClaudeCredentialQuotaDto): string {
  switch (quota?.fetchStatus) {
    case 'auth_required':
      return 'Quota unavailable · authentication required.'
    case 'rate_limited':
      return 'Quota unavailable · refresh request throttled.'
    case 'failed':
      return 'Quota unavailable · refresh failed.'
    case 'never':
    case undefined:
      return 'Quota not fetched yet.'
    default:
      return 'Quota windows are unavailable.'
  }
}

function clampQuotaPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, value))
}

function globalActiveCredentialId(pool?: CredentialPoolDto): string {
  return pool?.globalActive
    ?? pool?.credentials.find((credential) => credential.globalActive)?.id
    ?? ''
}

function canActivateClaudeCredential(credential: CredentialPoolCredentialDto): boolean {
  return credentialReadyLocal(credential)
    && !credential.exhausted
    && credential.quota?.fetchStatus !== 'auth_required'
    && credential.quotaEligibility !== 'near_limit'
    && credential.quotaEligibility !== 'blocked_5h'
    && credential.quotaEligibility !== 'blocked_weekly'
    && (credential.status === 'active' || credential.status === 'available')
}

function quotaEligibilityLabel(credential: CredentialPoolCredentialDto): string | null {
  if (
    credential.quota
    && effectiveClaudeQuotaFetchStatus(credential.quota) !== 'fresh'
  ) {
    return credential.quota.windows.length > 0 ? null : 'quota unknown'
  }
  switch (credential.quotaEligibility) {
    case 'ready':
      return 'quota ready'
    case 'near_limit':
      return 'near limit'
    case 'blocked_5h':
      return '5h blocked'
    case 'blocked_weekly':
      return 'weekly blocked'
    case 'unknown':
      return 'quota unknown'
    case undefined:
      return null
  }
}

function globalClaudeCredentialOptionLabel(
  credential: CredentialPoolCredentialDto,
  globalActive: boolean,
): string {
  const identity = credential.email
    ? `${credential.label} · ${credential.email}`
    : credential.label
  const state = globalActive
    ? `GLOBAL ACTIVE${credential.exhausted ? ' · cooling down' : ''}`
    : credential.quota?.fetchStatus === 'auth_required'
      ? 'authentication required'
      : credential.quotaEligibility === 'blocked_5h'
      ? '5h blocked'
      : credential.quotaEligibility === 'blocked_weekly'
        ? 'weekly blocked'
        : credentialStatusLabel('claude', credential)
  const fiveHour = credential.quota?.windows.find((window) => window.kind === 'five_hour')
  const fetchStatus = effectiveClaudeQuotaFetchStatus(credential.quota)
  const refreshIssue = credential.quota?.errorCode === 'rate_limited'
    ? 'refresh throttled'
    : credential.quota?.errorCode && credential.quota.fetchStatus === 'cached'
      ? 'refresh failed'
      : null
  const quota = fetchStatus === 'fresh'
    && fiveHour
    && Number.isFinite(fiveHour.utilizationPct)
    ? ` · 5h ${Math.round(clampQuotaPercent(fiveHour.utilizationPct))}%`
    : fetchStatus === 'cached'
      ? ` · quota cached${refreshIssue ? ` · ${refreshIssue}` : ''}`
      : fetchStatus === 'rate_limited'
        ? ' · refresh throttled'
        : fetchStatus === 'failed'
          ? ' · quota refresh failed'
          : fetchStatus === 'auth_required'
            ? ' · quota auth required'
            : fetchStatus === 'never'
              ? ' · quota not fetched'
              : ''
  return `${identity} · ${state}${quota}`
}

function rotationEventLabel(event?: CredentialPoolRotationEventDto): string {
  if (!event) {
    return 'none'
  }
  const from = event.previousCredentialLabel ?? event.previousCredentialId ?? 'unknown'
  const to = event.activeCredentialLabel ?? event.activeCredentialId
  const action = event.type === 'blocked'
    ? `${from} exhausted`
    : `${from} -> ${to ?? 'next credential'}`
  return `${action} · ${formatCredentialTimestamp(event.at)}`
}

function remoteTokenStatusLabel(flow: CredentialLoginFlowDto | null, credential?: CredentialPoolCredentialDto): string {
  if (flow) {
    if (flow.remoteToken.status === 'stored') {
      return flow.remoteToken.tokenLength ? `stored · length ${flow.remoteToken.tokenLength}` : 'stored'
    }
    if (flow.remoteToken.status === 'minting') {
      return 'minting'
    }
    if (flow.remoteToken.status === 'failed') {
      return 'failed'
    }
    if (flow.remoteToken.status === 'not_required') {
      return 'not required'
    }
  }
  if (credential?.remoteTokenPresent) {
    return credential.remoteTokenLength ? `stored · length ${credential.remoteTokenLength}` : 'stored'
  }
  return credential?.readiness?.remote === 'not_required' ? 'not required' : 'missing'
}

function guidedFlowRemoteReadinessLabel(flow: CredentialLoginFlowDto): string {
  if (flow.remoteToken.status === 'not_required' || flow.readiness?.remote === 'not_required') {
    return '✓ remote not required'
  }
  return flow.readiness?.readyRemote ? '✓ ready-remote' : '○ remote pending'
}

function guidedFlowStatusLabel(flow: CredentialLoginFlowDto): string {
  if (flow.status === 'ready_remote' && (flow.remoteToken.status === 'not_required' || flow.readiness?.remote === 'not_required')) {
    return 'remote-not-required'
  }
  return flow.status.replace('_', '-')
}

function providerPanelClassName(surface: CredentialPoolsPanelSurface): string {
  return surface === 'mobile'
    ? 'card-sumi overflow-hidden bg-[var(--hv-surface-card)] px-4 py-4'
    : 'border-b border-[var(--hv-border-hair)] pb-4 last:border-b-0 last:pb-0'
}

function tokenFormFieldClassName(surface: CredentialPoolsPanelSurface): string {
  return cn(
    'min-h-[72px] w-full resize-y rounded border border-[var(--hv-field-border)] bg-[var(--hv-field-bg)] px-3 py-2 font-mono text-[16px] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-field-placeholder)] focus:border-[var(--hv-field-focus-border)] focus:outline-none',
    surface === 'desktop' ? 'md:text-sm' : undefined,
  )
}

function CredentialRemoteTokenForm({
  provider,
  credentialId,
  surface,
  onStored,
}: {
  provider: CredentialPoolProvider
  credentialId: string
  surface: CredentialPoolsPanelSurface
  onStored(response: CredentialPoolRemoteTokenResponse): void | Promise<void>
}) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submitToken = useMutation({
    mutationFn: () => submitCredentialRemoteToken(provider, credentialId, token),
  })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) {
      return
    }
    setError(null)
    try {
      const response = await submitToken.mutateAsync()
      setToken('')
      await onStored(response)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Setup token could not be saved.')
    }
  }

  return (
    <form className="mt-3 space-y-2" onSubmit={handleSubmit}>
      <label className="block text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
        Paste Claude setup token
      </label>
      <textarea
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="CLAUDE_CODE_OAUTH_TOKEN=..."
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={tokenFormFieldClassName(surface)}
        data-testid={`credential-remote-token-input-${provider}-${credentialId}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={submitToken.isPending || token.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-[2px_8px] border border-[color:var(--hv-fg)] px-3 py-1.5 text-[11px] text-[color:var(--hv-fg)] shadow-[2px_2px_0_var(--hv-fg)] disabled:opacity-50"
        >
          <RefreshCw size={12} />
          {submitToken.isPending ? 'Saving token' : 'Save token'}
        </button>
        <span className="text-[11px] text-[color:var(--hv-fg-subtle)]">
          Stored as secret metadata; not shown after save.
        </span>
      </div>
      {error ? (
        <p className="text-xs text-[color:var(--hv-accent-danger)]">{error}</p>
      ) : null}
    </form>
  )
}

function CredentialLoginCodeForm({
  flow,
  surface,
  onSubmitted,
}: {
  flow: CredentialLoginFlowDto
  surface: CredentialPoolsPanelSurface
  onSubmitted(nextFlow: CredentialLoginFlowDto): void | Promise<void>
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submitCode = useMutation({
    mutationFn: (value: string) => submitCredentialLoginFlowInput(flow, value),
  })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) {
      return
    }
    setError(null)
    try {
      const nextFlow = await submitCode.mutateAsync(trimmed)
      setCode('')
      await onSubmitted(nextFlow)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authorization code could not be sent to the login terminal.')
    }
  }

  return (
    <form className="mt-3 space-y-2" onSubmit={handleSubmit}>
      <label className="block text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
        Paste OAuth authorization code
      </label>
      <textarea
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Code shown in the browser after sign-in"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={tokenFormFieldClassName(surface)}
        data-testid={`credential-login-code-input-${flow.provider}-${flow.credentialId}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={submitCode.isPending || code.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-[2px_8px] border border-[color:var(--hv-fg)] px-3 py-1.5 text-[11px] text-[color:var(--hv-fg)] shadow-[2px_2px_0_var(--hv-fg)] disabled:opacity-50"
        >
          <Terminal size={12} />
          {submitCode.isPending ? 'Completing login' : 'Complete login'}
        </button>
        <span className="text-[11px] text-[color:var(--hv-fg-subtle)]">
          Sent to the running login terminal to finish local login. This is not the setup token.
        </span>
      </div>
      {error ? (
        <p className="text-xs text-[color:var(--hv-accent-danger)]">{error}</p>
      ) : null}
    </form>
  )
}

function QuotaWindowBar({
  credentialLabel,
  window,
  primary = false,
}: {
  credentialLabel: string
  window: ClaudeQuotaWindowDto
  primary?: boolean
}) {
  const percent = clampQuotaPercent(window.utilizationPct)
  const roundedPercent = Math.round(percent)
  const displayLabel = window.kind === 'seven_day'
    ? `${window.label} overall`
    : window.scope
      ? `${window.label} · ${window.scope}`
      : window.label
  const fillClassName = percent >= 90
    ? 'bg-[var(--hv-accent-danger)]'
    : percent >= 70
      ? 'bg-[var(--hv-accent-warning)]'
      : 'bg-[var(--hv-accent-success)]'

  return (
    <div className={primary ? 'space-y-1.5' : 'space-y-1'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px]">
        <span className={cn(
          'font-medium text-[color:var(--hv-fg)]',
          primary ? 'text-xs' : undefined,
        )}>
          {displayLabel}
        </span>
        <span className="font-mono text-[color:var(--hv-fg-subtle)]">{roundedPercent}% used</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${credentialLabel} ${displayLabel} quota used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        aria-valuetext={`${roundedPercent}% used`}
        className={cn(
          'w-full overflow-hidden rounded-full bg-[var(--hv-border-hair)]',
          primary ? 'h-2.5' : 'h-1.5',
        )}
      >
        <div className={cn('h-full rounded-full', fillClassName)} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[10px] leading-relaxed text-[color:var(--hv-fg-muted)]">
        Resets {formatResetCountdown(window.resetsAt)}
        {window.resetsAt ? (
          <>
            {' · '}
            <time dateTime={window.resetsAt}>{formatQuotaTimestamp(window.resetsAt)}</time>
          </>
        ) : null}
      </p>
    </div>
  )
}

function ClaudeQuotaDetails({
  credential,
}: {
  credential: CredentialPoolCredentialDto
}) {
  const quota = credential.quota
  const fetchStatus = effectiveClaudeQuotaFetchStatus(quota)
  const fiveHour = quota?.windows.find((window) => window.kind === 'five_hour')
  const sevenDay = quota?.windows.find((window) => window.kind === 'seven_day')
  const scopedWindows = quota?.windows.filter((window) => window.kind === 'weekly_scoped') ?? []
  const hasWindows = Boolean(fiveHour || sevenDay || scopedWindows.length > 0)
  const eligibilityLabel = quotaEligibilityLabel(credential)
  const refreshIssue = fetchStatus === 'cached'
    ? quota?.errorCode === 'rate_limited'
      ? 'refresh throttled'
      : quota?.errorCode
        ? 'refresh failed'
        : null
    : null

  return (
    <div className="mt-3 rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-3" data-testid={`claude-quota-${credential.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
          Claude quota
        </p>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {eligibilityLabel ? (
            <span className="rounded-full border border-[color:var(--hv-border-soft)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-muted)]">
              {eligibilityLabel}
            </span>
          ) : null}
          <span className={cn(
            'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
            quotaFetchStatusClassName(fetchStatus),
          )}>
            {quotaFetchStatusLabel(fetchStatus)}
          </span>
          {refreshIssue ? (
            <span className="rounded-full border border-[color:var(--hv-accent-warning)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--hv-accent-warning)]">
              {refreshIssue}
            </span>
          ) : null}
        </div>
      </div>

      {hasWindows ? (
        <div className="mt-3 space-y-3">
          {fiveHour ? (
            <QuotaWindowBar credentialLabel={credential.label} window={fiveHour} primary />
          ) : (
            <p className="text-[11px] text-[color:var(--hv-fg-muted)]">5h quota unavailable.</p>
          )}
          {sevenDay ? (
            <QuotaWindowBar credentialLabel={credential.label} window={sevenDay} />
          ) : (
            <p className="text-[11px] text-[color:var(--hv-fg-muted)]">Overall weekly quota unavailable.</p>
          )}
          {scopedWindows.map((window, index) => (
            <QuotaWindowBar
              key={`${window.label}-${window.scope ?? 'all'}-${index}`}
              credentialLabel={credential.label}
              window={window}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-[color:var(--hv-fg-muted)]">
          {quotaUnavailableLabel(quota)}
        </p>
      )}

      {hasWindows && refreshIssue ? (
        <p className="mt-3 text-[11px] text-[color:var(--hv-fg-muted)]">
          {refreshIssue === 'refresh throttled'
            ? 'Latest refresh was throttled; showing the last successful remote quota.'
            : 'Latest refresh failed; showing the last successful remote quota.'}
        </p>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-[color:var(--hv-fg-faint)]">
        Fetched:{' '}
        {quota?.fetchedAt ? (
          <time dateTime={quota.fetchedAt}>{formatQuotaTimestamp(quota.fetchedAt)}</time>
        ) : 'never'}
        {' · '}Next refresh:{' '}
        {quota?.nextRefreshAt ? (
          <time dateTime={quota.nextRefreshAt}>{formatQuotaTimestamp(quota.nextRefreshAt)}</time>
        ) : 'unknown'}
      </p>
    </div>
  )
}

export function CredentialPoolsPanel({
  className,
  surface = 'mobile',
}: {
  className?: string
  surface?: CredentialPoolsPanelSurface
}) {
  return (
    <div className={cn('space-y-4', className)} data-testid="credential-pools-panel">
      {CREDENTIAL_POOL_PROVIDER_IDS.map((provider) => (
        <CredentialPoolProviderPanel key={provider} provider={provider} surface={surface} />
      ))}
    </div>
  )
}

function CredentialPoolProviderPanel({
  provider,
  surface,
}: {
  provider: CredentialPoolProvider
  surface: CredentialPoolsPanelSurface
}) {
  const queryClient = useQueryClient()
  const [lastInstructions, setLastInstructions] = useState<CredentialPoolRegisterResponse['instructions'] | null>(null)
  const [guidedFlow, setGuidedFlow] = useState<CredentialLoginFlowDto | null>(null)
  const [guidedFlowError, setGuidedFlowError] = useState<string | null>(null)
  const poolQuery = useQuery({
    queryKey: credentialPoolQueryKey(provider),
    queryFn: () => fetchCredentialPool(provider),
    staleTime: provider === 'claude' ? 10_000 : 30_000,
    refetchInterval: provider === 'claude' ? 15_000 : false,
    refetchIntervalInBackground: false,
  })
  const pool = poolQuery.data
  const credentials = pool?.credentials ?? []
  const globalCredentialId = provider === 'claude' ? globalActiveCredentialId(pool) : ''
  const guidedCredential = credentials.find((credential) => credential.id === guidedFlow?.credentialId)
  const guidedFlowId = guidedFlow?.id
  const guidedFlowProvider = guidedFlow?.provider
  const guidedFlowCredentialId = guidedFlow?.credentialId
  const guidedFlowStatus = guidedFlow?.status

  async function refreshPool(nextPool?: CredentialPoolDto): Promise<void> {
    if (nextPool) {
      queryClient.setQueryData(credentialPoolQueryKey(provider), nextPool)
    }
    await queryClient.invalidateQueries({ queryKey: credentialPoolQueryKey(provider) })
  }

  async function refreshGuidedFlowAfterTokenStore(flow: CredentialLoginFlowDto | null): Promise<void> {
    if (!flow) {
      return
    }
    try {
      setGuidedFlow(await fetchCredentialLoginFlow(flow))
    } catch {
      // Token storage succeeded but the flow poll failed; reflect only the
      // stored token and let readiness stay truthful until the next poll.
      setGuidedFlow((current) => (
        current?.id === flow.id
          ? { ...current, remoteToken: { status: 'stored' } }
          : current
      ))
    }
  }

  async function beginGuidedFlow(credential: CredentialPoolCredentialDto): Promise<void> {
    setGuidedFlowError(null)
    try {
      const flow = await startCredentialLoginFlow(provider, credential.id)
      setGuidedFlow(flow)
    } catch (error) {
      setGuidedFlowError(error instanceof Error ? error.message : 'Credential login flow could not start.')
    }
  }

  useEffect(() => {
    if (!guidedFlowId || !guidedFlowProvider || !guidedFlowCredentialId || guidedFlowStatus === 'ready_remote') {
      return undefined
    }
    const flowRef = {
      id: guidedFlowId,
      provider: guidedFlowProvider,
      credentialId: guidedFlowCredentialId,
    }
    let cancelled = false
    const poll = async () => {
      try {
        const nextFlow = await fetchCredentialLoginFlow(flowRef)
        if (cancelled) {
          return
        }
        setGuidedFlow(nextFlow)
        if (nextFlow.status === 'ready_remote') {
          await queryClient.invalidateQueries({ queryKey: credentialPoolQueryKey(provider) })
        }
      } catch (error) {
        if (!cancelled) {
          setGuidedFlowError(error instanceof Error ? error.message : 'Credential login flow status is unavailable.')
        }
      }
    }
    const timer = window.setInterval(() => {
      void poll()
    }, 1500)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [guidedFlowCredentialId, guidedFlowId, guidedFlowProvider, guidedFlowStatus, provider, queryClient])

  const addCredential = useMutation({
    mutationFn: () => fetchJson<CredentialPoolRegisterResponse>('/api/agents/provider-auth/pool/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        label: defaultCredentialLabel(provider, credentials.length),
      }),
    }),
    onSuccess: async (response) => {
      setLastInstructions(response.instructions)
      queryClient.setQueryData(credentialPoolQueryKey(provider), response.pool)
      await queryClient.invalidateQueries({ queryKey: credentialPoolQueryKey(provider) })
      await beginGuidedFlow(response.credential)
    },
  })
  const removeCredential = useMutation({
    mutationFn: (credentialId: string) => fetchJson<CredentialPoolDto>(
      `/api/agents/provider-auth/pool/credentials/${provider}/${encodeURIComponent(credentialId)}`,
      { method: 'DELETE' },
    ),
    onSuccess: async (nextPool) => {
      setLastInstructions(null)
      setGuidedFlow(null)
      queryClient.setQueryData(credentialPoolQueryKey(provider), nextPool)
      await queryClient.invalidateQueries({ queryKey: credentialPoolQueryKey(provider) })
    },
  })
  const finalizeFlow = useMutation({
    mutationFn: (flow: CredentialLoginFlowDto) => finalizeCredentialLoginFlow(flow),
    onSuccess: async (flow) => {
      setGuidedFlow(flow)
      await queryClient.invalidateQueries({ queryKey: credentialPoolQueryKey(provider) })
    },
    onError: (error) => {
      setGuidedFlowError(error instanceof Error ? error.message : 'Credential login flow could not finalize.')
    },
  })
  const activateCredential = useMutation({
    mutationFn: (credentialId: string) => activateClaudeCredential(credentialId),
    onSuccess: async (nextPool) => {
      await refreshPool(nextPool)
    },
  })
  const refreshQuota = useMutation({
    mutationFn: (credentialId: string | undefined) => refreshClaudeCredentialQuota(credentialId),
    onSuccess: (nextPool) => {
      queryClient.setQueryData(credentialPoolQueryKey('claude'), nextPool)
    },
  })

  return (
    <section className={providerPanelClassName(surface)} data-testid={`credential-pool-provider-${provider}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[color:var(--hv-fg)]">
            {CREDENTIAL_POOL_LABELS[provider]}
          </p>
          <p className="mt-1 text-xs text-[color:var(--hv-fg-subtle)]">
            {poolQuery.isLoading && !pool ? 'Loading credentials' : `${credentials.length} credential${credentials.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {provider === 'claude' ? (
            <button
              type="button"
              aria-label="Refresh quota for all Claude credentials"
              disabled={refreshQuota.isPending || credentials.length === 0}
              onClick={() => refreshQuota.mutate(undefined)}
              className="inline-flex min-h-11 items-center gap-2 rounded-[2px_8px] border border-[color:var(--hv-border-soft)] px-3 py-2 text-[11px] text-[color:var(--hv-fg-subtle)] disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshQuota.isPending && refreshQuota.variables === undefined ? 'animate-spin' : undefined} />
              {refreshQuota.isPending && refreshQuota.variables === undefined ? 'Refreshing all' : 'Refresh all'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={addCredential.isPending}
            onClick={() => addCredential.mutate()}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[2px_8px] border border-[color:var(--hv-fg)] px-3 py-2 text-[11px] text-[color:var(--hv-fg)] shadow-[2px_2px_0_var(--hv-fg)] disabled:opacity-50"
          >
            <Plus size={13} />
            Add credential
          </button>
        </div>
      </div>

      {provider === 'claude' ? (
        <div className="mt-4 rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-3">
          <label htmlFor="global-claude-credential" className="block text-[10.5px] font-medium uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
            Global Claude credential
          </label>
          <select
            id="global-claude-credential"
            aria-describedby="global-claude-credential-help"
            required
            value={globalCredentialId}
            disabled={activateCredential.isPending || credentials.length === 0}
            onChange={(event) => {
              const credentialId = event.target.value
              if (credentialId && credentialId !== globalCredentialId) {
                activateCredential.mutate(credentialId)
              }
            }}
            className="mt-2 min-h-11 w-full rounded border border-[var(--hv-field-border)] bg-[var(--hv-field-bg)] px-3 py-2 text-[16px] text-[color:var(--hv-fg)] focus:border-[var(--hv-field-focus-border)] focus:outline-none md:text-sm"
          >
            <option value="" disabled>— Select credential —</option>
            {credentials.map((credential) => (
              <option
                key={credential.id}
                value={credential.id}
                disabled={!canActivateClaudeCredential(credential) && credential.id !== globalCredentialId}
              >
                {globalClaudeCredentialOptionLabel(credential, credential.id === globalCredentialId)}
              </option>
            ))}
          </select>
          <p id="global-claude-credential-help" className="mt-2 text-[11px] leading-relaxed text-[color:var(--hv-fg-muted)]">
            All local Claude conversations share this global credential. Switching it changes the account beneath every local conversation.
          </p>
          <div aria-live="polite" className="mt-2 min-h-[1rem] text-[11px] text-[color:var(--hv-fg-subtle)]">
            {activateCredential.isPending ? 'Switching the global Claude credential…' : null}
            {activateCredential.isError ? 'The global Claude credential could not be switched.' : null}
            {activateCredential.isSuccess ? 'Global Claude credential switched.' : null}
          </div>
        </div>
      ) : null}

      {provider === 'claude' && (refreshQuota.isError || refreshQuota.isSuccess) ? (
        <p
          aria-live="polite"
          className={cn(
            'mt-3 text-xs',
            refreshQuota.isError
              ? 'text-[color:var(--hv-accent-danger)]'
              : 'text-[color:var(--hv-fg-subtle)]',
          )}
        >
          {refreshQuota.isError
            ? 'Claude quota refresh failed.'
            : 'Claude quota refreshed from remote usage.'}
        </p>
      ) : null}

      {poolQuery.error ? (
        <p className="mt-3 text-sm text-[color:var(--hv-accent-danger)]">
          {pool ? 'Credential pool refresh failed; shown data may be stale.' : 'Credential pool is unavailable.'}
        </p>
      ) : null}

      {credentials.length === 0 && !poolQuery.isLoading ? (
        <p className="mt-3 text-sm text-[color:var(--hv-fg-subtle)]">No credentials are configured.</p>
      ) : null}

      {guidedFlow || guidedFlowError ? (
        <div className="mt-3 rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-[color:var(--hv-fg)]">
                <Terminal size={14} />
                Add {CREDENTIAL_POOL_LABELS[provider]} credential
              </p>
              <p className="mt-1 text-[11px] text-[color:var(--hv-fg-subtle)]">
                {guidedCredential?.label ?? guidedFlow?.credentialId ?? 'Credential'}
              </p>
            </div>
            {guidedFlow ? (
              <span className="shrink-0 rounded-full border border-[color:var(--hv-border-soft)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-muted)]">
                {guidedFlowStatusLabel(guidedFlow)}
              </span>
            ) : null}
          </div>

          {guidedFlow ? (
            <>
              <pre className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg)] p-2 font-mono text-[10px] leading-relaxed text-[color:var(--hv-fg-subtle)]">
                {guidedFlow.transcript || `$ ${guidedFlow.command}`}
              </pre>
              <div className="mt-3 grid gap-2 text-[11px] text-[color:var(--hv-fg-subtle)] sm:grid-cols-3">
                <span>{guidedFlow.readiness.readyLocal ? '✓ ready-local' : '○ waiting for login'}</span>
                <span>{guidedFlowRemoteReadinessLabel(guidedFlow)}</span>
                <span>remote token: {remoteTokenStatusLabel(guidedFlow, guidedCredential)}</span>
              </div>
              {guidedFlow.remoteToken.error ? (
                <p className="mt-2 text-xs text-[color:var(--hv-accent-danger)]">{guidedFlow.remoteToken.error}</p>
              ) : null}
              {!guidedFlow.readiness.readyLocal && guidedCredential?.authBrokenReason ? (
                <p className="mt-2 text-xs text-[color:var(--hv-accent-danger)]">
                  auth broken: {guidedCredential.authBrokenReason}
                </p>
              ) : null}
              {!guidedFlow.readiness.readyLocal
                && (guidedFlow.status === 'running' || guidedFlow.status === 'starting') ? (
                <CredentialLoginCodeForm
                  flow={guidedFlow}
                  surface={surface}
                  onSubmitted={(nextFlow) => {
                    setGuidedFlowError(null)
                    setGuidedFlow(nextFlow)
                  }}
                />
              ) : null}
              {provider === 'claude' && !guidedFlow.readiness.readyRemote ? (
                <CredentialRemoteTokenForm
                  provider={provider}
                  credentialId={guidedFlow.credentialId}
                  surface={surface}
                  onStored={async (response) => {
                    setGuidedFlowError(null)
                    await refreshPool(response.pool)
                    await refreshGuidedFlowAfterTokenStore(guidedFlow)
                  }}
                />
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={finalizeFlow.isPending}
                  onClick={() => finalizeFlow.mutate(guidedFlow)}
                  className="inline-flex items-center gap-2 rounded-[2px_8px] border border-[color:var(--hv-fg)] px-3 py-1.5 text-[11px] text-[color:var(--hv-fg)] shadow-[2px_2px_0_var(--hv-fg)] disabled:opacity-50"
                >
                  <RefreshCw size={12} />
                  Check readiness
                </button>
                {guidedFlow.status === 'ready_remote' ? (
                  <button
                    type="button"
                    onClick={() => setGuidedFlow(null)}
                    className="inline-flex items-center rounded-[2px_8px] border border-[color:var(--hv-accent-success)] px-3 py-1.5 text-[11px] text-[color:var(--hv-accent-success)]"
                  >
                    Done
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          {guidedFlowError ? (
            <p className="mt-2 text-xs text-[color:var(--hv-accent-danger)]">{guidedFlowError}</p>
          ) : null}
        </div>
      ) : null}

      {credentials.length > 0 ? (
        <div className="mt-3 divide-y divide-[color:var(--hv-border-hair)] border-y border-[color:var(--hv-border-hair)]">
          {credentials.map((credential) => {
            const isGlobalActive = provider === 'claude' && credential.id === globalCredentialId
            const rowTitleId = `credential-${provider}-${credential.id}-title`
            return (
            <article key={credential.id} className="py-4" aria-labelledby={rowTitleId}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p id={rowTitleId} className="break-words text-sm text-[color:var(--hv-fg)]">{credential.label}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-[color:var(--hv-fg-faint)]">
                    {credential.email ?? credential.absoluteDir ?? credential.id}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:flex-wrap sm:justify-end">
                  {isGlobalActive ? (
                    <span className="rounded-full border border-[color:var(--hv-accent-success)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--hv-accent-success)]">
                      Global active
                    </span>
                  ) : null}
                  <span className={cn(
                    'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
                    credential.exhausted
                      ? 'border-[color:var(--hv-accent-danger)] text-[color:var(--hv-accent-danger)]'
                      : 'border-[color:var(--hv-border-soft)] text-[color:var(--hv-fg-muted)]',
                  )}>
                    {credentialStatusLabel(provider, credential)}
                  </span>
                </div>
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-[color:var(--hv-fg-subtle)]">
                <p>{credentialReadinessLabel(credential)} · remote token {remoteTokenStatusLabel(null, credential)}</p>
                <p>last used: {formatCredentialTimestamp(credential.lastUsedAt)} · live sessions: {credential.liveSessionCount ?? 0}</p>
                {(credential.liveSessions?.length ?? 0) > 0 ? (
                  <p className="truncate font-mono text-[10px] text-[color:var(--hv-fg-faint)]">
                    {credential.liveSessions?.map((session) => `${session.name}@${session.host}`).join(', ')}
                  </p>
                ) : null}
                <p>latest rotation: {rotationEventLabel(credential.latestRotationEvent)}</p>
              </div>
              {provider === 'claude' ? <ClaudeQuotaDetails credential={credential} /> : null}
              {provider === 'claude' && credentialReadyLocal(credential) && !credentialReadyRemote(credential) ? (
                <CredentialRemoteTokenForm
                  provider={provider}
                  credentialId={credential.id}
                  surface={surface}
                  onStored={async (response) => {
                    setGuidedFlowError(null)
                    await refreshPool(response.pool)
                    await refreshGuidedFlowAfterTokenStore(guidedFlow)
                  }}
                />
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {provider === 'claude' ? (
                  <button
                    type="button"
                    aria-label={`Refresh quota for ${credential.label}`}
                    disabled={refreshQuota.isPending}
                    onClick={() => refreshQuota.mutate(credential.id)}
                    className="inline-flex min-h-11 items-center gap-2 rounded border border-[color:var(--hv-border-soft)] px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)] transition-colors hover:text-[color:var(--hv-fg)] disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={refreshQuota.isPending && refreshQuota.variables === credential.id ? 'animate-spin' : undefined} />
                    {refreshQuota.isPending && refreshQuota.variables === credential.id ? 'Refreshing' : 'Refresh quota'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={removeCredential.isPending}
                  onClick={() => removeCredential.mutate(credential.id)}
                  className="inline-flex min-h-11 items-center gap-2 px-2 text-[11px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)] transition-colors hover:text-[color:var(--hv-accent-danger)] disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => void beginGuidedFlow(credential)}
                  className="inline-flex min-h-11 items-center gap-2 px-2 text-[11px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)] transition-colors hover:text-[color:var(--hv-fg)]"
                >
                  <Terminal size={12} />
                  Guide login
                </button>
              </div>
            </article>
            )
          })}
        </div>
      ) : null}

      {lastInstructions ? (
        <div className="mt-3 space-y-2">
          <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
            Copy-command fallback
          </p>
          <code className="block whitespace-pre-wrap break-words rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-2 text-[10px] text-[color:var(--hv-fg-subtle)]">
            {lastInstructions.commands.join('\n')}
          </code>
        </div>
      ) : null}
    </section>
  )
}
