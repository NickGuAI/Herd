import { FormEvent, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { AlertTriangle, Copy, KeyRound, LogOut, QrCode, Smartphone, Trash2 } from 'lucide-react'
import {
  useApiKeys,
  useApiKeyScopeCatalog,
  useClearGeminiImageGenerationKey,
  useClearOpenAITranscriptionKey,
  useCreateApiKey,
  useCreateMobileAccessInvite,
  useGeminiImageGenerationSettings,
  useOpenAITranscriptionSettings,
  useRevokeApiKey,
  useSetGeminiImageGenerationKey,
  useSetOpenAITranscriptionKey,
  type CreatedApiKey,
  type MobileAccessInvite,
} from '@/hooks/use-api-keys'
import { getBootstrapKeyRotationState } from '@/app/bootstrap-key-rotation'
import { useAuth } from '@/contexts/AuthContext'
import { timeAgo } from '@/lib/utils'
import { MagicBento, MagicBentoCard } from '@/components/MagicBento'
import { ConfirmModal } from '@modules/components/ConfirmModal'
import { Toast } from '@modules/components/Toast'
import { AccountProfileCard } from './components/AccountProfileCard'
import { OrgIdentityCard } from '@modules/org-identity/components/OrgIdentityCard'
import { ProviderAuthPanel } from '@modules/agents/components/ProviderAuthPanel'
import { CredentialPoolsPanel } from '@modules/settings/CredentialPoolsPanel'

interface ScopeOption {
  value: string
  label: string
  description?: string
}

type ScopePreset = 'operational' | 'bootstrap' | 'custom'

const ADMIN_SCOPE = 'agents:admin'
const BOOTSTRAP_ROTATION_QUERY = 'rotation'
const BOOTSTRAP_ROTATION_VALUE = 'bootstrap'

const SCOPE_COPY: Record<string, Omit<ScopeOption, 'value'>> = {
  'telemetry:read': { label: 'Telemetry read' },
  'telemetry:write': { label: 'Telemetry write' },
  'agents:read': { label: 'Agents read' },
  'agents:write': { label: 'Agents write' },
  'agents:admin': {
    label: 'Agents admin',
    description: 'Required to create, list, and revoke future API keys.',
  },
  'commanders:read': { label: 'Commanders read' },
  'commanders:write': { label: 'Commanders write' },
  'commanders:channels:write': { label: 'Channel bindings write' },
  'org:write': { label: 'Org write' },
  'services:read': { label: 'Services read' },
  'services:write': { label: 'Services write' },
  'skills:read': { label: 'Skills read' },
  'skills:write': { label: 'Skills write' },
}

const MOBILE_INVITE_EXPIRY_OPTIONS = [
  { value: '900', label: '15 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '21600', label: '6 hours' },
  { value: '86400', label: '24 hours' },
] as const

type MobileInviteExpiryOption = (typeof MOBILE_INVITE_EXPIRY_OPTIONS)[number]['value']

const FIELD_CLASS =
  'w-full rounded-lg border border-[var(--hv-field-border)] bg-[var(--hv-field-bg)] px-3 py-2 text-[16px] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-field-placeholder)] focus:outline-none focus:border-[var(--hv-field-focus-border)] md:text-sm'

const ERROR_CLASS =
  'flex items-start gap-2 rounded-lg bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]'

type PendingConfirmation =
  | { kind: 'revoke-api-key'; keyId: string; keyName: string }
  | { kind: 'clear-openai-key' }
  | { kind: 'clear-gemini-key' }

interface ConfirmationCopy {
  title: string
  message: string
  confirmLabel: string
}

function humanizeScope(value: string): string {
  return value
    .split(':')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildScopeOptions(scopes: readonly string[]): ScopeOption[] {
  return scopes.map((value) => {
    const copy = SCOPE_COPY[value]
    return {
      value,
      label: copy?.label ?? humanizeScope(value),
      ...(copy?.description ? { description: copy.description } : {}),
    }
  })
}

function sameScopeSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  const rightScopes = new Set(right)
  return left.every((scope) => rightScopes.has(scope))
}

function inferScopePreset(
  scopes: readonly string[],
  operationalScopes: readonly string[],
  bootstrapScopes: readonly string[],
): ScopePreset {
  if (bootstrapScopes.length > 0 && sameScopeSet(scopes, bootstrapScopes)) {
    return 'bootstrap'
  }
  if (operationalScopes.length > 0 && sameScopeSet(scopes, operationalScopes)) {
    return 'operational'
  }
  return 'custom'
}

function scrollCreateKeyIntoView() {
  if (typeof window === 'undefined') {
    return
  }

  const schedule = window.requestAnimationFrame ?? window.setTimeout
  schedule(() => {
    const createKeyForm = document.getElementById('settings-create-api-key-form')
    if (typeof createKeyForm?.scrollIntoView !== 'function') {
      return
    }

    createKeyForm.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  })
}

function consumeBootstrapRotationRequest(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const url = new URL(window.location.href)
  if (url.searchParams.get(BOOTSTRAP_ROTATION_QUERY) !== BOOTSTRAP_ROTATION_VALUE) {
    return false
  }

  url.searchParams.delete(BOOTSTRAP_ROTATION_QUERY)
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  return true
}

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

function getConfirmationCopy(action: PendingConfirmation): ConfirmationCopy {
  if (action.kind === 'revoke-api-key') {
    return {
      title: 'Revoke API key?',
      message: `Revoke "${action.keyName}"? Scripts using this key will lose access immediately.`,
      confirmLabel: 'Revoke key',
    }
  }

  if (action.kind === 'clear-openai-key') {
    return {
      title: 'Remove OpenAI transcription key?',
      message: 'Microphone transcription will stop working until a new OpenAI key is saved.',
      confirmLabel: 'Remove key',
    }
  }

  return {
    title: 'Remove Gemini image generation key?',
    message: 'Avatar image generation will stop working until a new Gemini API key is saved.',
    confirmLabel: 'Remove key',
  }
}

export default function ApiKeysPage() {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [scopePreset, setScopePreset] = useState<ScopePreset>('operational')
  const [scopeSelectionInitialized, setScopeSelectionInitialized] = useState(false)
  const [openAIApiKey, setOpenAIApiKey] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [mobileInviteExpiry, setMobileInviteExpiry] =
    useState<MobileInviteExpiryOption>('3600')
  const [mobileInvite, setMobileInvite] = useState<MobileAccessInvite | null>(null)
  const [mobileInviteQrDataUrl, setMobileInviteQrDataUrl] = useState<string | null>(null)
  const [mobileInviteCopyState, setMobileInviteCopyState] =
    useState<'idle' | 'copied'>('idle')
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const {
    data: keys = [],
    isLoading,
    error,
  } = useApiKeys()
  const {
    data: scopeCatalog,
    isLoading: isScopeCatalogLoading,
    error: scopeCatalogError,
  } = useApiKeyScopeCatalog()
  const createMutation = useCreateApiKey()
  const createMobileInviteMutation = useCreateMobileAccessInvite()
  const revokeMutation = useRevokeApiKey()
  const { data: transcriptionSettings, error: transcriptionSettingsError } =
    useOpenAITranscriptionSettings()
  const { data: geminiImageSettings, error: geminiImageSettingsError } =
    useGeminiImageGenerationSettings()
  const setOpenAIMutation = useSetOpenAITranscriptionKey()
  const clearOpenAIMutation = useClearOpenAITranscriptionKey()
  const setGeminiMutation = useSetGeminiImageGenerationKey()
  const clearGeminiMutation = useClearGeminiImageGenerationKey()

  const sortedKeys = useMemo(
    () =>
      [...keys].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [keys],
  )
  const allScopeValues = useMemo(() => scopeCatalog?.scopes ?? [], [scopeCatalog?.scopes])
  const bootstrapScopeValues = useMemo(
    () => scopeCatalog?.defaultBootstrapScopes ?? [],
    [scopeCatalog?.defaultBootstrapScopes],
  )
  const operationalScopeValues = useMemo(
    () => allScopeValues.filter((scope) => scope !== ADMIN_SCOPE),
    [allScopeValues],
  )
  const mobileScopeValues = useMemo(
    () => scopeCatalog?.mobilePairingScopes ?? [],
    [scopeCatalog?.mobilePairingScopes],
  )
  const scopeOptions = useMemo(() => buildScopeOptions(allScopeValues), [allScopeValues])
  const allScopesSelected = allScopeValues.length > 0 && sameScopeSet(selectedScopes, allScopeValues)
  const bootstrapRotationState = useMemo(
    () => getBootstrapKeyRotationState(sortedKeys, scopeCatalog),
    [sortedKeys, scopeCatalog],
  )
  const mobileInvitePayload = mobileInvite?.qrPayload ?? mobileInvite?.invite ?? null
  const mobileScopes = mobileInvite?.scopes.length ? mobileInvite.scopes : mobileScopeValues

  const createError =
    createMutation.error instanceof Error ? createMutation.error.message : null
  const scopeCatalogErrorMessage =
    scopeCatalogError instanceof Error ? scopeCatalogError.message : null
  const mobileInviteError =
    createMobileInviteMutation.error instanceof Error
      ? createMobileInviteMutation.error.message
      : null
  const revokeError =
    revokeMutation.error instanceof Error ? revokeMutation.error.message : null
  const transcriptionError =
    (setOpenAIMutation.error instanceof Error
      ? setOpenAIMutation.error.message
      : null) ??
    (clearOpenAIMutation.error instanceof Error
      ? clearOpenAIMutation.error.message
      : null) ??
    (transcriptionSettingsError instanceof Error
      ? transcriptionSettingsError.message
      : null)
  const imageGenerationError =
    (setGeminiMutation.error instanceof Error
      ? setGeminiMutation.error.message
      : null) ??
    (clearGeminiMutation.error instanceof Error
      ? clearGeminiMutation.error.message
      : null) ??
    (geminiImageSettingsError instanceof Error
      ? geminiImageSettingsError.message
      : null)
  const listError = error instanceof Error ? error.message : null

  function applyScopeSelection(scopes: readonly string[]) {
    const uniqueScopes = [...new Set(scopes)].filter((scope) => allScopeValues.includes(scope))
    setSelectedScopes(uniqueScopes)
    setScopePreset(inferScopePreset(uniqueScopes, operationalScopeValues, bootstrapScopeValues))
  }

  function applyScopePreset(nextPreset: Exclude<ScopePreset, 'custom'>) {
    const nextScopes = nextPreset === 'bootstrap' ? bootstrapScopeValues : operationalScopeValues
    setSelectedScopes([...nextScopes])
    setScopePreset(nextPreset)
  }

  function prepareBootstrapEquivalentKey() {
    applyScopePreset('bootstrap')
    setName((current) => current.trim() || 'Permanent Bootstrap Admin Key')
    scrollCreateKeyIntoView()
  }

  useEffect(() => {
    if (scopeSelectionInitialized || operationalScopeValues.length === 0) {
      return
    }

    setSelectedScopes([...operationalScopeValues])
    setScopePreset('operational')
    setScopeSelectionInitialized(true)
  }, [operationalScopeValues, scopeSelectionInitialized])

  useEffect(() => {
    if (!scopeSelectionInitialized || bootstrapScopeValues.length === 0) {
      return
    }

    if (!consumeBootstrapRotationRequest()) {
      return
    }

    setSelectedScopes([...bootstrapScopeValues])
    setScopePreset('bootstrap')
    setName((current) => current.trim() || 'Permanent Bootstrap Admin Key')
    scrollCreateKeyIntoView()
  }, [bootstrapScopeValues, scopeSelectionInitialized])

  useEffect(() => {
    let cancelled = false
    setMobileInviteQrDataUrl(null)

    if (!mobileInvitePayload) {
      return () => {
        cancelled = true
      }
    }

    void QRCode.toDataURL(mobileInvitePayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 192,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setMobileInviteQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMobileInviteQrDataUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [mobileInvitePayload])

  useEffect(() => {
    if (!toastMessage) {
      return
    }

    const timer = window.setTimeout(() => {
      setToastMessage(null)
    }, 2500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [toastMessage])

  async function handleCreateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      return
    }

    const created = await createMutation.mutateAsync({
      name: trimmedName,
      scopes: selectedScopes,
    })
    setName('')
    setCreatedKey(created)
    setCopyState('idle')
  }

  async function handleCopyKey() {
    if (!createdKey) {
      return
    }

    await navigator.clipboard.writeText(createdKey.key)
    setCopyState('copied')
  }

  async function handleCreateMobileInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mobileScopeValues.length === 0) {
      return
    }

    const created = await createMobileInviteMutation.mutateAsync({
      expiresInSeconds: Number(mobileInviteExpiry),
      scopes: [...mobileScopeValues],
    })
    setMobileInvite(created)
    setMobileInviteCopyState('idle')
  }

  async function handleCopyMobileInvite() {
    if (!mobileInvitePayload) {
      return
    }

    await navigator.clipboard.writeText(mobileInvitePayload)
    setMobileInviteCopyState('copied')
  }

  async function handleSaveOpenAIKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedKey = openAIApiKey.trim()
    if (!trimmedKey) {
      return
    }

    await setOpenAIMutation.mutateAsync(trimmedKey)
    setOpenAIApiKey('')
    setToastMessage('OpenAI transcription key saved.')
  }

  async function handleConfirmPendingAction(): Promise<void> {
    const action = pendingConfirmation
    if (!action) {
      return
    }

    setPendingConfirmation(null)

    if (action.kind === 'revoke-api-key') {
      await revokeMutation.mutateAsync(action.keyId)
      setToastMessage(`Revoked ${action.keyName}.`)
      return
    }

    if (action.kind === 'clear-openai-key') {
      await clearOpenAIMutation.mutateAsync()
      setToastMessage('OpenAI transcription key removed.')
      return
    }

    await clearGeminiMutation.mutateAsync()
    setToastMessage('Gemini image generation key removed.')
  }

  async function handleSaveGeminiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedKey = geminiApiKey.trim()
    if (!trimmedKey) {
      return
    }

    await setGeminiMutation.mutateAsync(trimmedKey)
    setGeminiApiKey('')
    setToastMessage('Gemini image generation key saved.')
  }

  const confirmationCopy = pendingConfirmation ? getConfirmationCopy(pendingConfirmation) : null

  return (
    <div className="px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto max-w-6xl">
        <div>
          <h2 className="font-display text-display text-[color:var(--hv-fg)]">Settings</h2>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--hv-fg-subtle)] leading-relaxed">
            Configure the founder profile, provider keys, and scoped API access for agents and scripts.
            Keys are shown only once at creation time.
          </p>
        </div>

        {bootstrapRotationState.shouldPrompt && bootstrapRotationState.expiresAt && (
          <div
            className="mt-6 flex flex-col gap-3 rounded-lg border border-[var(--hv-accent-warning)] bg-[var(--hv-accent-warning-wash)] p-4 text-sm text-[color:var(--hv-fg)] md:flex-row md:items-center md:justify-between"
            data-testid="settings-bootstrap-rotation-prompt"
          >
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle
                size={18}
                className="mt-0.5 shrink-0 text-[color:var(--hv-accent-warning)]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">Rotate the temporary bootstrap API key.</p>
                <p className="mt-1 text-[color:var(--hv-fg-subtle)]">
                  {bootstrapRotationState.keyName ?? 'The bootstrap key'} expires {formatExpiry(bootstrapRotationState.expiresAt)}. Create a permanent bootstrap-equivalent admin key before it expires.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-primary inline-flex shrink-0 items-center justify-center gap-2"
              onClick={prepareBootstrapEquivalentKey}
            >
              <KeyRound size={14} />
              Create bootstrap-equivalent key
            </button>
          </div>
        )}

        <MagicBento className="mt-6 md:mt-8" data-testid="settings-magic-bento">
          <MagicBentoCard span={6} data-testid="settings-bento-org">
            <OrgIdentityCard />
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-account">
            <AccountProfileCard />
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-provider-auth">
            <ProviderAuthPanel />
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-credential-pools">
            <div className="flex h-full flex-col">
              <div>
                <p className="section-title">Credential pools</p>
                <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                  Add and refresh Claude or Codex account pools for provider recovery.
                </p>
              </div>
              <CredentialPoolsPanel className="mt-4" surface="desktop" />
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={3} data-testid="settings-bento-transcription">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Transcription (OpenAI Realtime)</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    Mic input uses this key for live transcription.
                  </p>
                </div>
                <span
                  className={`badge-sumi ${
                    transcriptionSettings?.configured ? 'badge-active' : 'badge-idle'
                  }`}
                >
                  {transcriptionSettings?.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <form className="mt-4 space-y-3" onSubmit={handleSaveOpenAIKey}>
                <input
                  type="password"
                  value={openAIApiKey}
                  onChange={(event) => setOpenAIApiKey(event.target.value)}
                  placeholder={transcriptionSettings?.configured ? 'sk-... (stored)' : 'sk-...'}
                  className={FIELD_CLASS}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={setOpenAIMutation.isPending}
                    className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {setOpenAIMutation.isPending ? 'Saving...' : 'Save OpenAI Key'}
                  </button>
                  {transcriptionSettings?.configured && (
                    <button
                      type="button"
                      disabled={clearOpenAIMutation.isPending}
                      className="btn-ghost text-[color:var(--hv-accent-danger)] disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => setPendingConfirmation({ kind: 'clear-openai-key' })}
                    >
                      {clearOpenAIMutation.isPending ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              </form>

              {transcriptionSettings?.updatedAt && (
                <p className="mt-3 text-whisper text-[color:var(--hv-fg-faint)]">
                  Updated {timeAgo(transcriptionSettings.updatedAt)}
                </p>
              )}

              {transcriptionError && (
                <div className={`${ERROR_CLASS} mt-3`}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{transcriptionError}</span>
                </div>
              )}
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={3} data-testid="settings-bento-image-generation">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Image Generation (Gemini API)</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    Used by avatar generation in the commander edit form.
                  </p>
                  <p className="mt-2 text-sm text-[color:var(--hv-accent-danger)]">
                    This key is for avatar generation only. It is not the Gemini CLI provider key configured per machine.
                  </p>
                </div>
                <span
                  className={`badge-sumi ${
                    geminiImageSettings?.configured ? 'badge-active' : 'badge-idle'
                  }`}
                >
                  {geminiImageSettings?.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <form className="mt-4 space-y-3" onSubmit={handleSaveGeminiKey}>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(event) => setGeminiApiKey(event.target.value)}
                  placeholder={geminiImageSettings?.configured ? 'AIza... (stored)' : 'AIza...'}
                  className={FIELD_CLASS}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={setGeminiMutation.isPending}
                    className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {setGeminiMutation.isPending ? 'Saving...' : 'Save Gemini Key'}
                  </button>
                  {geminiImageSettings?.configured && (
                    <button
                      type="button"
                      disabled={clearGeminiMutation.isPending}
                      className="btn-ghost text-[color:var(--hv-accent-danger)] disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => setPendingConfirmation({ kind: 'clear-gemini-key' })}
                    >
                      {clearGeminiMutation.isPending ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              </form>

              {geminiImageSettings?.updatedAt && (
                <p className="mt-3 text-whisper text-[color:var(--hv-fg-faint)]">
                  Updated {timeAgo(geminiImageSettings.updatedAt)}
                </p>
              )}

              {imageGenerationError && (
                <div className={`${ERROR_CLASS} mt-3`}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{imageGenerationError}</span>
                </div>
              )}
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-mobile-access">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Mobile Access</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    Generate an expiring pairing invite for the iOS app.
                  </p>
                </div>
                <Smartphone size={20} className="mt-0.5 text-[color:var(--hv-fg-faint)]" />
              </div>

              <div className="mt-4">
                <p className="text-whisper text-[color:var(--hv-fg-faint)]">Mobile scopes</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {mobileScopes.length > 0 ? (
                    mobileScopes.map((scope) => (
                      <span key={scope} className="badge-sumi badge-active font-mono">
                        {scope}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[color:var(--hv-fg-subtle)]">
                      Loading mobile scopes...
                    </span>
                  )}
                </div>
              </div>

              <form
                className="mt-4 space-y-3"
                data-testid="mobile-access-form"
                onSubmit={handleCreateMobileInvite}
              >
                <div>
                  <label htmlFor="mobile-access-expiry" className="section-title block mb-2">
                    Invite Expiry
                  </label>
                  <select
                    id="mobile-access-expiry"
                    name="mobile-access-expiry"
                    value={mobileInviteExpiry}
                    onChange={(event) =>
                      setMobileInviteExpiry(event.target.value as MobileInviteExpiryOption)
                    }
                    className={FIELD_CLASS}
                    data-testid="mobile-access-expiry-select"
                    required
                  >
                    <option value="" disabled>
                      -- Select expiry --
                    </option>
                    {MOBILE_INVITE_EXPIRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={createMobileInviteMutation.isPending || mobileScopeValues.length === 0}
                  className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <Smartphone size={14} />
                  {createMobileInviteMutation.isPending ? 'Generating...' : 'Generate Invite'}
                </button>

                {mobileInviteError && (
                  <div className={ERROR_CLASS}>
                    <AlertTriangle size={15} className="mt-0.5" />
                    <span>{mobileInviteError}</span>
                  </div>
                )}
              </form>

              {mobileInvite && mobileInvitePayload && (
                <div className="mt-5 rounded-lg border border-[var(--hv-accent-warning)] bg-[var(--hv-accent-warning-wash)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="section-title">Pairing Invite</p>
                      <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                        Expires {formatExpiry(mobileInvite.expiresAt)}
                      </p>
                      {mobileInvite.keyPrefix && (
                        <p className="mt-1 text-whisper font-mono text-[color:var(--hv-fg-faint)]">
                          {mobileInvite.keyPrefix}...
                        </p>
                      )}
                      {mobileInvite.instanceUrl && (
                        <p className="mt-1 text-whisper font-mono text-[color:var(--hv-fg-faint)]">
                          {mobileInvite.instanceUrl}
                        </p>
                      )}
                    </div>
                    {mobileInviteQrDataUrl ? (
                      <img
                        src={mobileInviteQrDataUrl}
                        alt="Mobile access pairing QR"
                        className="h-24 w-24 rounded-md border border-[var(--hv-border-hair)] bg-white p-1"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-md border border-[var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[color:var(--hv-fg-faint)]">
                        <QrCode size={28} />
                      </div>
                    )}
                  </div>
                  <code className="mt-3 block max-h-32 overflow-y-auto rounded-md bg-[var(--hv-bg-raised)] px-3 py-2 text-xs break-all text-[color:var(--hv-fg)]">
                    {mobileInvitePayload}
                  </code>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary inline-flex items-center gap-2"
                      onClick={handleCopyMobileInvite}
                    >
                      <Copy size={14} />
                      {mobileInviteCopyState === 'copied' ? 'Copied' : 'Copy invite'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setMobileInvite(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-managed-keys">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-[var(--hv-border-hair)] pb-3">
                <span className="font-mono text-sm text-[color:var(--hv-fg)]">Managed Keys</span>
                <span className="text-whisper text-[color:var(--hv-fg-faint)]">{sortedKeys.length} keys</span>
              </div>

              {isLoading ? (
                <div className="py-5 text-sm text-[color:var(--hv-fg-subtle)]">Loading keys...</div>
              ) : (
                <div className="divide-y divide-[var(--hv-border-hair)]">
                  {sortedKeys.length === 0 ? (
                    <div className="py-5 text-sm text-[color:var(--hv-fg-subtle)]">No API keys yet.</div>
                  ) : (
                    sortedKeys.map((key) => (
                      <div
                        key={key.id}
                        className="py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-[color:var(--hv-fg)] font-medium">{key.name}</p>
                          <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)] font-mono truncate">
                            {key.prefix}...
                          </p>
                          <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
                            Created {timeAgo(key.createdAt)} by {key.createdBy}
                          </p>
                          <p className="text-whisper text-[color:var(--hv-fg-faint)]">
                            Last used {key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'never'}
                          </p>
                          {key.expiresAt && (
                            <p className="text-whisper text-[color:var(--hv-fg-faint)]">
                              Expires {formatExpiry(key.expiresAt)}
                            </p>
                          )}
                          <p className="mt-1 text-whisper text-[color:var(--hv-fg-subtle)]">
                            {key.scopes.length === 0
                              ? 'No scopes'
                              : `Scopes: ${key.scopes.join(', ')}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost inline-flex items-center gap-2 text-[color:var(--hv-accent-danger)] shrink-0 self-start"
                          disabled={revokeMutation.isPending}
                          onClick={() => {
                            setPendingConfirmation({
                              kind: 'revoke-api-key',
                              keyId: key.id,
                              keyName: key.name,
                            })
                          }}
                        >
                          <Trash2 size={14} />
                          Revoke
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {(listError || revokeError) && (
                <div className={`${ERROR_CLASS} mt-3`}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{listError ?? revokeError}</span>
                </div>
              )}
            </div>
          </MagicBentoCard>

          {auth && (
            <MagicBentoCard span={3} data-testid="settings-bento-sign-out">
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <p className="section-title">Session</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    End the current browser session.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={auth.signOut}
                  className="btn-ghost inline-flex items-center justify-center gap-2"
                >
                  <LogOut size={18} />
                  Sign out
                </button>
              </div>
            </MagicBentoCard>
          )}

          <MagicBentoCard span={9} data-testid="settings-bento-create-key">
            <form
              id="settings-create-api-key-form"
              data-testid="create-api-key-form"
              onSubmit={handleCreateKey}
              className="space-y-4"
            >
              <div>
                <label htmlFor="api-key-name" className="section-title block mb-2">Key Name</label>
                <input
                  id="api-key-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Telemetry Ingest Key"
                  className={FIELD_CLASS}
                  required
                />
              </div>

              <div>
                <p className="section-title block mb-2">Scope Preset</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={scopePreset === 'operational'}
                    onClick={() => applyScopePreset('operational')}
                    disabled={operationalScopeValues.length === 0}
                    className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      scopePreset === 'operational'
                        ? 'border-[var(--hv-accent-primary)] bg-[var(--hv-bg-raised)]'
                        : 'border-[var(--hv-border-hair)] bg-transparent hover:bg-[var(--hv-bg-raised)]'
                    }`}
                  >
                    <span className="block text-sm font-medium text-[color:var(--hv-fg)]">
                      Operational key
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[color:var(--hv-fg-subtle)]">
                      Excludes agents:admin, so it can run agents and services but cannot manage future API keys.
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={scopePreset === 'bootstrap'}
                    onClick={() => applyScopePreset('bootstrap')}
                    disabled={bootstrapScopeValues.length === 0}
                    className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      scopePreset === 'bootstrap'
                        ? 'border-[var(--hv-accent-primary)] bg-[var(--hv-bg-raised)]'
                        : 'border-[var(--hv-border-hair)] bg-transparent hover:bg-[var(--hv-bg-raised)]'
                    }`}
                  >
                    <span className="block text-sm font-medium text-[color:var(--hv-fg)]">
                      Bootstrap-equivalent admin
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[color:var(--hv-fg-subtle)]">
                      Selects every default bootstrap scope, including agents:admin and skills:write, for permanent admin recovery.
                    </span>
                  </button>
                </div>
                {scopePreset === 'custom' && (
                  <p className="mt-2 text-xs text-[color:var(--hv-fg-subtle)]">
                    Custom scope set selected.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="section-title block">Scopes</label>
                  <button
                    type="button"
                    className="text-whisper text-sm text-[color:var(--hv-fg-subtle)] hover:text-[color:var(--hv-fg-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isScopeCatalogLoading || allScopeValues.length === 0}
                    onClick={() => applyScopeSelection(allScopesSelected ? [] : allScopeValues)}
                  >
                    {allScopesSelected ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {isScopeCatalogLoading && (
                    <div className="text-sm text-[color:var(--hv-fg-subtle)]">
                      Loading available scopes...
                    </div>
                  )}
                  {!isScopeCatalogLoading && scopeOptions.length === 0 && (
                    <div className="text-sm text-[color:var(--hv-fg-subtle)]">
                      No scopes available.
                    </div>
                  )}
                  {scopeOptions.map((scope) => {
                    const checked = selectedScopes.includes(scope.value)
                    return (
                      <label
                        key={scope.value}
                        className="flex items-start gap-2 text-sm text-[color:var(--hv-fg-muted)]"
                      >
                        <input
                          type="checkbox"
                          value={scope.value}
                          checked={checked}
                          onChange={(event) => {
                            const nextScopes = event.target.checked
                              ? [...selectedScopes, scope.value]
                              : selectedScopes.filter((value) => value !== scope.value)
                            applyScopeSelection(nextScopes)
                          }}
                        />
                        <span>
                          {scope.label}
                          {scope.description ? ` (${scope.description})` : ''}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  isScopeCatalogLoading ||
                  allScopeValues.length === 0
                }
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                <KeyRound size={14} />
                {createMutation.isPending ? 'Creating...' : 'Create Key'}
              </button>

              {(createError || scopeCatalogErrorMessage) && (
                <div className={ERROR_CLASS}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{createError ?? scopeCatalogErrorMessage}</span>
                </div>
              )}
            </form>

            {createdKey && (
              <div className="mt-5 rounded-lg border border-[var(--hv-accent-warning)] bg-[var(--hv-accent-warning-wash)] p-4">
                <p className="section-title">Copy this key now</p>
                <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                  This is the only time the raw key is visible.
                </p>
                <code className="mt-3 block rounded-md bg-[var(--hv-bg-raised)] px-3 py-2 text-xs break-all text-[color:var(--hv-fg)]">
                  {createdKey.key}
                </code>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-2"
                    onClick={handleCopyKey}
                  >
                    <Copy size={14} />
                    {copyState === 'copied' ? 'Copied' : 'Copy key'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setCreatedKey(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </MagicBentoCard>
        </MagicBento>
      </div>
      <Toast open={Boolean(toastMessage)} message={toastMessage ?? ''} />
      {confirmationCopy && (
        <ConfirmModal
          open={Boolean(pendingConfirmation)}
          title={confirmationCopy.title}
          message={confirmationCopy.message}
          confirmLabel={confirmationCopy.confirmLabel}
          confirmTone="danger"
          onClose={() => setPendingConfirmation(null)}
          onConfirm={() => void handleConfirmPendingAction()}
          bodyTestId="api-key-confirm-modal"
        />
      )}
    </div>
  )
}
