import type { CSSProperties } from 'react'
import type { AgentType } from '@/types'
import {
  credentialPoolCredentialOptionLabel,
  isCredentialPoolCredentialSelectable,
  isCredentialPoolProvider,
  useCredentialPool,
} from '@/hooks/use-credential-pools'

export function canSelectConversationCredential(
  provider: AgentType | null | undefined,
  host?: string | null,
): boolean {
  if (!isCredentialPoolProvider(provider)) {
    return false
  }
  if (provider !== 'claude') {
    return true
  }
  const targetHost = host?.trim()
  return Boolean(targetHost && targetHost !== 'local')
}

export function CredentialPoolSelect({
  provider,
  host,
  value,
  currentCredentialPoolId,
  onChange,
  disabled = false,
  dataTestId,
  className,
  style,
}: {
  provider: AgentType | null | undefined
  host?: string | null
  value: string | null
  currentCredentialPoolId?: string | null
  onChange: (credentialPoolId: string | null) => void
  disabled?: boolean
  dataTestId: string
  className?: string
  style?: CSSProperties
}) {
  const poolQuery = useCredentialPool(provider)
  if (!canSelectConversationCredential(provider, host)) {
    return null
  }

  const credentials = poolQuery.data?.credentials ?? []
  const knownIds = new Set(credentials.map((credential) => credential.id))
  const missingSelectedId = value && !knownIds.has(value) ? value : null
  const missingCurrentId = currentCredentialPoolId
    && !knownIds.has(currentCredentialPoolId)
    && currentCredentialPoolId !== missingSelectedId
    ? currentCredentialPoolId
    : null

  return (
    <select
      className={className}
      data-testid={dataTestId}
      value={value ?? ''}
      onChange={(event) => onChange(event.currentTarget.value || null)}
      disabled={disabled}
      aria-label="Credential"
      aria-busy={poolQuery.isFetching || undefined}
      style={style}
    >
      <option value="">Automatic</option>
      {missingSelectedId ? (
        <option value={missingSelectedId} disabled>
          Selected credential ({missingSelectedId}) · unavailable
        </option>
      ) : null}
      {missingCurrentId ? (
        <option value={missingCurrentId} disabled>
          Current credential ({missingCurrentId}) · unavailable
        </option>
      ) : null}
      {credentials.map((credential) => (
        <option
          key={credential.id}
          value={credential.id}
          disabled={!isCredentialPoolCredentialSelectable(provider, credential, host)}
        >
          {credentialPoolCredentialOptionLabel(provider, credential, host)}
        </option>
      ))}
    </select>
  )
}
