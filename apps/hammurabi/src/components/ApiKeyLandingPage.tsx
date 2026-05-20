import { useState } from 'react'
import { getFullUrl } from '@/lib/api-base'

/**
 * API-key-only landing page. Used when Auth0 is disabled or when running in
 * Capacitor (where Auth0 checkSession hangs in the WebView).
 */
export function ApiKeyLandingPage({
  onApiKeySubmit,
}: {
  onApiKeySubmit: (key: string) => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const res = await fetch(getFullUrl('/api/modules'), {
        headers: { 'X-Hammurabi-Api-Key': trimmed },
      })
      if (!res.ok) {
        setSubmitError('Invalid API key or insufficient scopes. Check key and try again.')
        return
      }
      onApiKeySubmit(trimmed)
    } catch {
      setSubmitError('Connection failed. Check network and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--hv-bg-raised)]">
      <div className="card-sumi max-w-md w-full mx-4 p-12 animate-fade-in">
        <h1 className="font-display text-display text-[color:var(--hv-fg)] mb-2 text-center">
          Hervald
        </h1>
        <p className="text-sm font-body text-[color:var(--hv-fg-subtle)] mb-6 text-center">
          Sign in with API key
        </p>

        <div className="divider-ink mb-6" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Paste your API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-field-focus-border)]"
            autoComplete="off"
            autoFocus
            disabled={isSubmitting}
          />
          {submitError && (
            <p className="text-sm text-[color:var(--hv-accent-danger)]" role="alert">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={!apiKey.trim() || isSubmitting}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Verifying...' : 'Sign in'}
          </button>
        </form>

        <p className="text-whisper text-[color:var(--hv-fg-faint)] mt-8 uppercase text-center">
          Authenticated access only
        </p>
      </div>
    </div>
  )
}
