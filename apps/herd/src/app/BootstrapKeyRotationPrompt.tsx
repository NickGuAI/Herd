import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AlertTriangle, KeyRound, X } from 'lucide-react'
import { useApiKeys, useApiKeyScopeCatalog } from '@/hooks/use-api-keys'
import { getBootstrapKeyRotationState } from './bootstrap-key-rotation'

const DISMISSED_ROTATION_STORAGE_KEY = 'herd_bootstrap_rotation_dismissed'

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return expiresAt
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function readDismissedRotationId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem(DISMISSED_ROTATION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeDismissedRotationId(rotationId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DISMISSED_ROTATION_STORAGE_KEY, rotationId)
  } catch {
    // Local dismissal is best-effort presentation state; keep the CTA visible.
  }
}

export function BootstrapKeyRotationPrompt() {
  const location = useLocation()
  const [dismissedRotationId, setDismissedRotationId] = useState(readDismissedRotationId)
  const {
    data: keys = [],
    error: keysError,
  } = useApiKeys()
  const {
    data: scopeCatalog,
    error: scopeCatalogError,
  } = useApiKeyScopeCatalog()

  const rotationState = useMemo(
    () => getBootstrapKeyRotationState(keys, scopeCatalog),
    [keys, scopeCatalog],
  )

  const rotationId = rotationState.keyId && rotationState.expiresAt
    ? `${rotationState.keyId}:${rotationState.expiresAt}`
    : null

  if (keysError || scopeCatalogError || !rotationState.shouldPrompt || !rotationState.expiresAt) {
    return null
  }

  if (location.pathname === '/api-keys' || location.pathname.startsWith('/api-keys/')) {
    return null
  }

  if (!rotationId || dismissedRotationId === rotationId) {
    return null
  }

  function dismissPrompt(): void {
    if (!rotationId) {
      return
    }

    writeDismissedRotationId(rotationId)
    setDismissedRotationId(rotationId)
  }

  return (
    <div
      className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[9998] md:bottom-6 md:left-auto md:right-6 md:w-[24rem]"
      data-testid="bootstrap-key-rotation-prompt"
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto rounded-lg border border-[var(--hv-accent-warning)] bg-[var(--hv-accent-warning-wash)] p-4 text-sm text-[color:var(--hv-fg)] shadow-[var(--hv-shadow-block)]"
      >
        <div className="flex min-w-0 items-start gap-3 pr-7">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-[color:var(--hv-accent-warning)]"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-medium">Rotate the temporary bootstrap API key.</p>
            <p className="mt-1 text-[color:var(--hv-fg-subtle)]">
              {rotationState.keyName ?? 'The bootstrap key'} expires {formatExpiry(rotationState.expiresAt)}. Create a permanent bootstrap-equivalent admin key before it expires.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link
            to="/api-keys?rotation=bootstrap"
            className="btn-primary inline-flex min-h-10 flex-1 shrink-0 items-center justify-center gap-2"
          >
            <KeyRound size={14} />
            Create permanent key
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--hv-border)] bg-[var(--hv-bg)] text-[color:var(--hv-fg-subtle)] transition-colors hover:border-[var(--hv-border-firm)] hover:text-[color:var(--hv-fg)]"
            onClick={dismissPrompt}
            aria-label="Dismiss bootstrap key rotation notice"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
