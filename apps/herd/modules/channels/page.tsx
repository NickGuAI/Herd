import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  Hash,
  Mail,
  MessageCircle,
  MessageSquare,
  Plug,
  QrCode,
  Save,
  Send,
  Slack,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'
import { useOrgTree } from '@modules/org/hooks/useOrgTree'
import {
  useBeginChannelPairing,
  useChannelPairingStatus,
  useChannelStatus,
  useChannelProviderDescriptors,
  useChannels,
  useCompleteChannelPairing,
  useCreateChannelBinding,
  useDeleteChannelBinding,
  useUpdateChannelBinding,
} from './hooks/useChannels'
import type {
  ChannelDescriptorField,
  ChannelProviderDescriptor,
  ChannelPairingChallenge,
  CommanderChannelBinding,
  CommanderChannelProvider,
} from './types'
import {
  formStateFromDescriptor,
  getChannelFormFieldErrors,
  getFirstChannelFormError,
  isIdentityField,
  normalizeChannelFormValue,
  type ChannelFieldErrors,
  type ChannelFormState,
  type ChannelFormValue,
} from './form-contract'

const INPUT_CLASS =
  'w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm'
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-ink-border text-sumi-black focus:ring-sumi-black/20'

const SECTION_LABELS: Record<string, string> = {
  advanced: 'Advanced (optional)',
  binding: 'Routing',
  configuration: 'Configuration',
  credentials: 'Credentials',
  outbound: 'Message limits',
  policy: 'Who can reach the agent',
}

function modalTitleForProvider(descriptor: ChannelProviderDescriptor | null): string {
  if (!descriptor) {
    return 'Connect Channel'
  }
  return descriptor.pairing.mode === 'qr'
    ? `Pair ${descriptor.label}`
    : `Connect ${descriptor.label}`
}

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section
}

function providerLabel(descriptor: ChannelProviderDescriptor | null, fallback: string): string {
  return descriptor?.label ?? fallback
}

function parseChannelMutationError(error: unknown, fallback: string): {
  message: string
  fieldErrors: ChannelFieldErrors
} {
  if (!(error instanceof Error)) {
    return { message: fallback, fieldErrors: {} }
  }

  const jsonStart = error.message.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(error.message.slice(jsonStart)) as {
        error?: unknown
        fieldErrors?: unknown
      }
      const fieldErrors = payload.fieldErrors && typeof payload.fieldErrors === 'object' && !Array.isArray(payload.fieldErrors)
        ? Object.fromEntries(Object.entries(payload.fieldErrors).filter((entry): entry is [string, string] => (
            typeof entry[0] === 'string' && typeof entry[1] === 'string'
          )))
        : {}
      return {
        message: typeof payload.error === 'string' ? payload.error : error.message,
        fieldErrors,
      }
    } catch {
      return { message: error.message, fieldErrors: {} }
    }
  }

  return { message: error.message, fieldErrors: {} }
}

function providerIcon(provider: CommanderChannelProvider): LucideIcon {
  switch (provider) {
    case 'email':
      return Mail
    case 'whatsapp':
      return MessageCircle
    case 'googlechat':
      return MessageSquare
    case 'telegram':
      return Send
    case 'discord':
      return Hash
    case 'slack':
      return Slack
    default:
      return Plug
  }
}

function providerHasBindingStatus(descriptor: ChannelProviderDescriptor | null | undefined): boolean {
  return typeof descriptor?.pairing.statusPollIntervalMs === 'number'
}

function formatChannelDropTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function channelErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ChannelErrorState({
  title,
  error,
  onRetry,
}: {
  title: string
  error: unknown
  onRetry?: () => void
}) {
  return (
    <div
      className="rounded-lg border border-accent-vermillion/30 bg-accent-vermillion/10 px-4 py-3 text-sm text-accent-vermillion"
      role="alert"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-accent-vermillion/30 px-2 py-1 text-xs font-medium text-accent-vermillion transition-colors hover:bg-accent-vermillion/10"
          >
            Retry
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs">{channelErrorMessage(error, title)}</p>
    </div>
  )
}

export default function ChannelsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    data: orgTree,
    isLoading: orgTreeLoading,
    error: orgTreeError,
    refetch: refetchOrgTree,
  } = useOrgTree()
  const commanders = orgTree?.commanders ?? []
  const requestedCommanderId = searchParams.get('commander')
  const [selectedCommanderId, setSelectedCommanderId] = useState(requestedCommanderId ?? '')
  const [provider, setProvider] = useState<CommanderChannelProvider>('')
  const [formByProvider, setFormByProvider] = useState<Record<string, ChannelFormState>>({})
  const [pairingChallenge, setPairingChallenge] = useState<ChannelPairingChallenge | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<ChannelFieldErrors>({})
  const [channelModalOpen, setChannelModalOpen] = useState(false)
  const completingPairingIdRef = useRef<string | null>(null)

  const {
    data: providerDescriptorResponse,
    isLoading: providerDescriptorsLoading,
    error: providerDescriptorsError,
    refetch: refetchProviderDescriptors,
  } = useChannelProviderDescriptors(selectedCommanderId || null)
  const providerDescriptors = providerDescriptorResponse?.providers ?? []
  const selectedProviderDescriptor = providerDescriptors.find((entry) => entry.provider === provider) ?? null
  const selectedForm = selectedProviderDescriptor
    ? formByProvider[provider] ?? formStateFromDescriptor(selectedProviderDescriptor)
    : {}

  useEffect(() => {
    if (requestedCommanderId) {
      setSelectedCommanderId(requestedCommanderId)
      return
    }
    if (!selectedCommanderId && commanders[0]) {
      setSelectedCommanderId(commanders[0].id)
    }
  }, [commanders, requestedCommanderId, selectedCommanderId])

  useEffect(() => {
    if (providerDescriptors.length === 0) {
      return
    }
    if (provider && providerDescriptors.some((entry) => entry.provider === provider)) {
      return
    }
    setProvider(providerDescriptors[0]?.provider ?? '')
  }, [provider, providerDescriptors])

  useEffect(() => {
    if (!selectedProviderDescriptor || formByProvider[provider]) {
      return
    }
    setFormByProvider((current) => ({
      ...current,
      [provider]: formStateFromDescriptor(selectedProviderDescriptor),
    }))
  }, [formByProvider, provider, selectedProviderDescriptor])

  const selectedCommander = useMemo(
    () => commanders.find((commander) => commander.id === selectedCommanderId) ?? null,
    [commanders, selectedCommanderId],
  )
  const {
    data: bindings = [],
    isLoading: bindingsLoading,
    error,
    refetch: refetchBindings,
  } = useChannels(selectedCommanderId || null)
  const bindingsByProvider = useMemo(() => {
    const grouped = new Map<CommanderChannelProvider, CommanderChannelBinding[]>()
    for (const binding of bindings) {
      grouped.set(binding.provider, [...(grouped.get(binding.provider) ?? []), binding])
    }
    return grouped
  }, [bindings])
  const selectedProviderBindings = provider
    ? bindingsByProvider.get(provider) ?? []
    : []
  const selectedEnabledBinding = selectedProviderBindings.find((binding) => binding.enabled) ?? null
  const shouldPollSelectedProviderStatus = Boolean(
    selectedEnabledBinding && providerHasBindingStatus(selectedProviderDescriptor),
  )
  const { data: selectedProviderStatus } = useChannelStatus(
    selectedEnabledBinding?.commanderId ?? '',
    selectedEnabledBinding?.id ?? '',
    shouldPollSelectedProviderStatus,
  )
  const selectedProviderConnected = Boolean(
    selectedEnabledBinding && (!shouldPollSelectedProviderStatus || selectedProviderStatus?.connected === true),
  )
  const createMutation = useCreateChannelBinding()
  const beginPairingMutation = useBeginChannelPairing()
  const completePairingMutation = useCompleteChannelPairing()
  const pairingProvider = pairingChallenge?.provider ?? provider
  const pairingStatusQuery = useChannelPairingStatus(
    selectedCommanderId || null,
    pairingChallenge?.id ?? null,
    pairingProvider,
    pairingChallenge?.accountId ?? null,
    Boolean(pairingChallenge),
  )
  const updateMutation = useUpdateChannelBinding()
  const deleteMutation = useDeleteChannelBinding()
  const activePairingChallenge = pairingStatusQuery.data ?? pairingChallenge
  const activePairingState = pairingStatusQuery.data?.state ?? (pairingChallenge ? 'pairing' : null)
  const activePairingConnected = Boolean(pairingStatusQuery.data?.connected || activePairingChallenge?.kind === 'connected')

  function updateSelectedForm(updater: (current: ChannelFormState) => ChannelFormState) {
    if (!selectedProviderDescriptor) {
      return
    }
    setFormByProvider((current) => {
      const previous = current[provider] ?? formStateFromDescriptor(selectedProviderDescriptor)
      return { ...current, [provider]: updater(previous) }
    })
  }

  function handleCommanderChange(nextCommanderId: string) {
    setSelectedCommanderId(nextCommanderId)
    setFormByProvider({})
    setPairingChallenge(null)
    setChannelModalOpen(false)
    completingPairingIdRef.current = null
    const nextParams = new URLSearchParams(searchParams)
    if (nextCommanderId) {
      nextParams.set('commander', nextCommanderId)
    } else {
      nextParams.delete('commander')
    }
    setSearchParams(nextParams, { replace: true })
  }

  function handleOpenChannelModal(nextProvider: CommanderChannelProvider) {
    setProvider(nextProvider)
    setPairingChallenge(null)
    setFormError(null)
    setFieldErrors({})
    setChannelModalOpen(true)
    completingPairingIdRef.current = null
  }

  function handleCloseChannelModal() {
    setChannelModalOpen(false)
    setPairingChallenge(null)
    setFormError(null)
    setFieldErrors({})
    completingPairingIdRef.current = null
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    if (!selectedCommanderId) {
      setFormError('Select a commander.')
      return
    }
    if (!selectedProviderDescriptor) {
      setFormError('Select a provider.')
      return
    }
    const validationErrors = getChannelFormFieldErrors(selectedProviderDescriptor, selectedForm)
    const firstMissingField = Object.keys(validationErrors)[0]
    if (firstMissingField) {
      setFieldErrors(validationErrors)
      setFormError('Fill the required fields marked below.')
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLElement>(`[data-channel-field-key="${firstMissingField}"]`)?.focus()
      })
      return
    }

    const nextAccountId = typeof selectedForm.accountId === 'string' ? selectedForm.accountId.trim() : ''
    const nextDisplayName = typeof selectedForm.displayName === 'string' ? selectedForm.displayName.trim() : ''
    setFormError(null)
    setFieldErrors({})
    try {
      if (selectedProviderDescriptor.pairing.mode !== 'none') {
        const challenge = await beginPairingMutation.mutateAsync({
          commanderId: selectedCommanderId,
          provider,
          accountId: nextAccountId || undefined,
          displayName: nextDisplayName,
          formValues: selectedForm,
        })
        setPairingChallenge(challenge)
        completingPairingIdRef.current = null
        return
      }

      await createMutation.mutateAsync({
        commanderId: selectedCommanderId,
        provider,
        accountId: nextAccountId,
        displayName: nextDisplayName,
        enabled: true,
        formValues: selectedForm,
      })
      setFormByProvider((current) => ({
        ...current,
        [provider]: formStateFromDescriptor(selectedProviderDescriptor),
      }))
      setPairingChallenge(null)
    } catch (createError) {
      const parsed = parseChannelMutationError(createError, 'Failed to add channel.')
      setFieldErrors(parsed.fieldErrors)
      setFormError(parsed.message)
      const firstFieldError = Object.keys(parsed.fieldErrors)[0]
      if (firstFieldError) {
        window.requestAnimationFrame(() => {
          formElement.querySelector<HTMLElement>(`[data-channel-field-key="${firstFieldError}"]`)?.focus()
        })
      }
    }
  }

  async function handleCompletePairing() {
    if (!selectedCommanderId || !pairingChallenge?.id || !selectedProviderDescriptor) {
      return
    }
    completingPairingIdRef.current = pairingChallenge.id
    setFormError(null)
    try {
      await completePairingMutation.mutateAsync({
        commanderId: selectedCommanderId,
        provider: pairingProvider,
        challengeId: pairingChallenge.id,
        accountId: (pairingChallenge.accountId ?? (typeof selectedForm.accountId === 'string' ? selectedForm.accountId.trim() : '')) || undefined,
        displayName: typeof selectedForm.displayName === 'string' ? selectedForm.displayName.trim() : '',
        formValues: selectedForm,
      })
      setFormByProvider((current) => ({
        ...current,
        [provider]: formStateFromDescriptor(selectedProviderDescriptor),
      }))
      setPairingChallenge(null)
      completingPairingIdRef.current = null
    } catch (completeError) {
      completingPairingIdRef.current = null
      const parsed = parseChannelMutationError(completeError, 'Failed to complete channel pairing.')
      setFieldErrors(parsed.fieldErrors)
      setFormError(parsed.message)
    }
  }

  useEffect(() => {
    if (!selectedCommanderId || !pairingChallenge?.id || !pairingStatusQuery.data?.connected) {
      return
    }
    if (completePairingMutation.isPending || completingPairingIdRef.current === pairingChallenge.id) {
      return
    }
    void handleCompletePairing()
  }, [
    completePairingMutation.isPending,
    pairingChallenge?.id,
    pairingStatusQuery.data?.connected,
    selectedCommanderId,
  ])

  const mutationError =
    formError
    ?? (error instanceof Error ? error.message : null)
    ?? (beginPairingMutation.error instanceof Error ? beginPairingMutation.error.message : null)
    ?? (pairingStatusQuery.error instanceof Error ? pairingStatusQuery.error.message : null)
    ?? (completePairingMutation.error instanceof Error ? completePairingMutation.error.message : null)
    ?? (updateMutation.error instanceof Error ? updateMutation.error.message : null)
    ?? (deleteMutation.error instanceof Error ? deleteMutation.error.message : null)

  return (
    <div className="px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <h1 className="font-display text-display text-sumi-black">Channels</h1>
        </div>

        <section className="card-sumi p-5">
          {orgTreeError ? (
            <div className="mb-4">
              <ChannelErrorState
                title="Failed to load commanders"
                error={orgTreeError}
                onRetry={() => {
                  void refetchOrgTree()
                }}
              />
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] md:items-end">
            <div>
              <p className="section-title">Selected commander</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-ink-border bg-washi-aged font-display text-lg text-sumi-black">
                  {selectedCommander?.displayName.slice(0, 1).toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-sumi-black">
                    {selectedCommander?.displayName ?? 'Select a commander'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-sumi-diluted">
                    {orgTreeLoading ? 'Loading commanders...' : selectedCommander?.id ?? 'No commander selected'}
                  </p>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="section-title block">Commander</span>
              <select
                value={selectedCommanderId}
                onChange={(event) => handleCommanderChange(event.target.value)}
                className={INPUT_CLASS}
                required
              >
                <option value="">Select Commander</option>
                {commanders.map((commander) => (
                  <option key={commander.id} value={commander.id}>
                    {commander.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 border-t border-ink-border pt-4">
            <p className="section-title">Support channels</p>
            {providerDescriptorsLoading && selectedCommander ? (
              <p className="mt-3 text-sm text-sumi-diluted">Loading channel providers...</p>
            ) : providerDescriptorsError ? (
              <div className="mt-3">
                <ChannelErrorState
                  title="Failed to load channel providers"
                  error={providerDescriptorsError}
                  onRetry={() => {
                    void refetchProviderDescriptors()
                  }}
                />
              </div>
            ) : (
              <ChannelProviderStrip
                descriptors={providerDescriptors}
                bindingsByProvider={bindingsByProvider}
                commanderName={selectedCommander?.displayName ?? 'selected commander'}
                activeProvider={channelModalOpen ? provider : ''}
                disabled={!selectedCommander}
                onOpen={handleOpenChannelModal}
              />
            )}
          </div>
        </section>

        <ModalFormContainer
          open={channelModalOpen && Boolean(selectedProviderDescriptor)}
          title={modalTitleForProvider(selectedProviderDescriptor)}
          onClose={handleCloseChannelModal}
          desktopClassName="max-w-5xl"
          mobileClassName="max-h-[96dvh]"
        >
          {selectedProviderDescriptor ? (
            <form onSubmit={(event) => void handleCreate(event)} className="grid gap-4" noValidate>
              <section className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="section-title">{selectedProviderDescriptor.label}</p>
                    <p className="mt-1 text-sm text-sumi-diluted">
                      {selectedCommander?.displayName ?? 'Selected commander'}
                    </p>
                  </div>
                  <span
                    data-testid="channel-modal-provider-status"
                    className={[
                      'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium',
                      selectedProviderConnected
                        ? 'border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)]'
                        : 'border-ink-border bg-washi-white text-sumi-diluted',
                    ].join(' ')}
                  >
                    {selectedProviderConnected ? (
                      <Check size={12} aria-hidden="true" />
                    ) : null}
                    {selectedProviderConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              </section>

              <ChannelSetupGuide
                key={`${selectedProviderDescriptor.provider}-${selectedProviderConnected ? 'connected' : 'new'}`}
                descriptor={selectedProviderDescriptor}
                defaultOpen={!selectedProviderConnected}
              />

              <div className="grid gap-4 md:grid-cols-3">
                <DescriptorFields
                  fields={selectedProviderDescriptor.fields.filter(isIdentityField)}
                  state={selectedForm}
                  descriptor={selectedProviderDescriptor}
                  fieldErrors={fieldErrors}
                  onChange={updateSelectedForm}
                  onFieldErrorClear={(fieldKey) => {
                    setFieldErrors((current) => {
                      if (!current[fieldKey]) {
                        return current
                      }
                      const next = { ...current }
                      delete next[fieldKey]
                      return next
                    })
                  }}
                />
              </div>

              <DescriptorFieldSections
                fields={selectedProviderDescriptor.fields.filter((field) => !isIdentityField(field))}
                state={selectedForm}
                descriptor={selectedProviderDescriptor}
                fieldErrors={fieldErrors}
                onChange={updateSelectedForm}
                onFieldErrorClear={(fieldKey) => {
                  setFieldErrors((current) => {
                    if (!current[fieldKey]) {
                      return current
                    }
                    const next = { ...current }
                    delete next[fieldKey]
                    return next
                  })
                }}
              />

              {activePairingChallenge ? (
                <section className="rounded-xl border border-ink-border bg-washi-aged p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <QrCode size={18} aria-hidden="true" />
                        <p className="section-title">
                          {providerLabel(selectedProviderDescriptor, String(pairingProvider))} Pairing
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-sumi-diluted">{activePairingChallenge.instructions}</p>
                      <p className="mt-2 font-mono text-xs text-sumi-diluted">
                        {activePairingChallenge.accountId} · {activePairingState ?? 'pending'} · expires {activePairingChallenge.expiresAt ?? 'soon'}
                      </p>
                    </div>
                    {activePairingChallenge.url ? (
                      <img
                        src={activePairingChallenge.url}
                        alt={`${providerLabel(selectedProviderDescriptor, String(pairingProvider))} pairing QR`}
                        className="h-52 w-52 rounded-lg border border-ink-border bg-washi-white p-2"
                      />
                    ) : null}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void pairingStatusQuery.refetch()}
                      disabled={completePairingMutation.isPending || activePairingConnected || pairingStatusQuery.isFetching}
                      className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {completePairingMutation.isPending || activePairingConnected
                        ? 'Completing...'
                        : pairingStatusQuery.isFetching
                          ? 'Checking...'
                          : 'Check Status'}
                    </button>
                  </div>
                </section>
              ) : null}

              {mutationError ? (
                <p className="text-sm text-accent-vermillion" role="alert">{mutationError}</p>
              ) : null}

              <div className="sticky bottom-0 z-10 mt-4 flex justify-end border-t border-ink-border bg-washi-white/95 py-3 backdrop-blur">
                <button
                  type="submit"
                  disabled={createMutation.isPending || beginPairingMutation.isPending || !selectedCommander || !selectedProviderDescriptor}
                  className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createMutation.isPending || beginPairingMutation.isPending
                    ? 'Adding...'
                    : selectedProviderDescriptor.pairing.mode === 'none'
                      ? 'Add Channel'
                      : 'Start Pairing'}
                </button>
              </div>

              {selectedProviderBindings.length > 0 ? (
                <section className="grid gap-3 border-t border-ink-border pt-4">
                  <div>
                    <p className="section-title">Connected bindings</p>
                    <p className="mt-1 text-sm text-sumi-diluted">
                      {selectedProviderBindings.length} {selectedProviderBindings.length === 1 ? 'binding' : 'bindings'} for {selectedProviderDescriptor.label}
                    </p>
                  </div>
                  {selectedProviderBindings.map((binding) => (
                    <BindingRow
                      key={binding.id}
                      binding={binding}
                      commanderId={selectedCommanderId}
                      updateBinding={(input) => updateMutation.mutateAsync(input)}
                      deleteBinding={(bindingId) => deleteMutation.mutateAsync({
                        commanderId: selectedCommanderId,
                        bindingId,
                      })}
                    />
                  ))}
                </section>
              ) : null}
            </form>
          ) : null}
        </ModalFormContainer>

        {mutationError && !channelModalOpen ? (
          <p className="text-sm text-accent-vermillion">{mutationError}</p>
        ) : null}

        <section className="card-sumi p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Bindings</p>
              <p className="mt-2 text-sm text-sumi-diluted">
                {selectedCommander ? selectedCommander.displayName : 'Select a commander'}
              </p>
            </div>
            <span className="badge-sumi badge-idle">{bindings.length}</span>
          </div>

          <div className="mt-5 space-y-3">
            {bindingsLoading && selectedCommander ? (
              <p className="text-sm text-sumi-diluted">Loading channel bindings...</p>
            ) : error ? (
              <ChannelErrorState
                title="Failed to load channel bindings"
                error={error}
                onRetry={() => {
                  void refetchBindings()
                }}
              />
            ) : bindings.length > 0 ? bindings.map((binding) => (
              <BindingRow
                key={binding.id}
                binding={binding}
                commanderId={selectedCommanderId}
                updateBinding={(input) => updateMutation.mutateAsync(input)}
                deleteBinding={(bindingId) => deleteMutation.mutateAsync({
                  commanderId: selectedCommanderId,
                  bindingId,
                })}
              />
            )) : (
              <p className="text-sm text-sumi-diluted">(no channel bindings)</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ChannelProviderStrip(props: {
  descriptors: ChannelProviderDescriptor[]
  bindingsByProvider: Map<CommanderChannelProvider, CommanderChannelBinding[]>
  commanderName: string
  activeProvider: CommanderChannelProvider
  disabled: boolean
  onOpen: (provider: CommanderChannelProvider) => void
}) {
  if (props.descriptors.length === 0) {
    return (
      <p className="mt-3 text-sm text-sumi-diluted">(no channel providers)</p>
    )
  }

  return (
    <div
      className="mt-3 flex flex-wrap gap-3"
      role="group"
      aria-label={`Support channels for ${props.commanderName}`}
      data-testid="channel-provider-strip"
    >
      {props.descriptors.map((descriptor) => {
        return (
          <ChannelProviderButton
            key={descriptor.provider}
            descriptor={descriptor}
            bindings={props.bindingsByProvider.get(descriptor.provider) ?? []}
            commanderName={props.commanderName}
            active={props.activeProvider === descriptor.provider}
            disabled={props.disabled}
            onOpen={props.onOpen}
          />
        )
      })}
    </div>
  )
}

function ChannelProviderButton(props: {
  descriptor: ChannelProviderDescriptor
  bindings: CommanderChannelBinding[]
  commanderName: string
  active: boolean
  disabled: boolean
  onOpen: (provider: CommanderChannelProvider) => void
}) {
  const Icon = providerIcon(props.descriptor.provider)
  const binding = props.bindings.find((candidate) => candidate.enabled) ?? null
  const shouldPollStatus = Boolean(binding && providerHasBindingStatus(props.descriptor))
  const { data: channelStatus } = useChannelStatus(binding?.commanderId ?? '', binding?.id ?? '', shouldPollStatus)
  const connected = Boolean(binding && (!shouldPollStatus || channelStatus?.connected === true))
  const openAction = props.descriptor.pairing.mode === 'qr'
    ? 'Open pairing and configuration.'
    : 'Open configuration.'

  return (
    <button
      type="button"
      data-testid={`channel-provider-${props.descriptor.provider}`}
      data-connected={connected ? 'true' : 'false'}
      aria-pressed={props.active}
      aria-label={`${props.descriptor.label} channel for ${props.commanderName}: ${connected ? 'connected' : 'not connected'}. ${openAction}`}
      title={`${props.descriptor.label} ${connected ? 'connected' : 'not connected'}`}
      disabled={props.disabled}
      onClick={() => props.onOpen(props.descriptor.provider)}
      className={[
        'relative inline-flex min-h-14 min-w-16 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-accent-info)] disabled:cursor-not-allowed disabled:opacity-60',
        connected
          ? 'border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)]'
          : 'border-ink-border bg-washi-aged text-sumi-black hover:bg-ink-wash',
        props.active ? 'ring-2 ring-[color:var(--hv-accent-info)]' : '',
      ].join(' ')}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="max-w-24 truncate">{props.descriptor.label}</span>
      {connected ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--hv-accent-success)] bg-washi-white text-[color:var(--hv-accent-success)]">
          <Check size={12} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  )
}

function ChannelSetupGuide(props: {
  descriptor: ChannelProviderDescriptor
  defaultOpen: boolean
}) {
  const guide = props.descriptor.setupGuide
  const [open, setOpen] = useState(props.defaultOpen)
  if (!guide || guide.steps.length === 0) {
    return null
  }

  return (
    <details
      className="rounded-lg border border-ink-border bg-washi-white px-4 py-3"
      data-testid={`channel-setup-guide-${props.descriptor.provider}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer select-none text-sm font-medium text-sumi-black">
        {guide.summary}
      </summary>
      <div className="mt-3 grid gap-3 text-sm text-sumi-black">
        {guide.steps.map((step, index) => (
          <div key={`${step.title}-${index}`} className="border-t border-ink-border pt-3 first:border-t-0 first:pt-0">
            <p className="font-medium">{index + 1}. {step.title}</p>
            <p className="mt-1 text-sumi-diluted">{renderGuideText(step.body)}</p>
          </div>
        ))}
      </div>
    </details>
  )
}

function renderGuideText(text: string) {
  const nodes = []
  const linkPattern = /https?:\/\/[^\s),.]+(?:[),.][^\s),.]+)*/gu
  let cursor = 0
  for (const match of text.matchAll(linkPattern)) {
    const href = match[0]
    const index = match.index ?? 0
    if (index > cursor) {
      nodes.push(text.slice(cursor, index))
    }
    nodes.push(
      <a
        key={`${href}-${index}`}
        href={href}
        target="_blank"
        rel="noopener"
        className="font-medium text-[color:var(--hv-accent-info)] underline decoration-[color:var(--hv-accent-info)]/30 underline-offset-2 hover:decoration-current"
      >
        {href.replace(/^https?:\/\//u, '')}
      </a>,
    )
    cursor = index + href.length
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }
  return nodes
}

function DescriptorFieldSections(props: {
  fields: ChannelDescriptorField[]
  state: ChannelFormState
  descriptor: ChannelProviderDescriptor
  fieldErrors?: ChannelFieldErrors
  onChange: (updater: (current: ChannelFormState) => ChannelFormState) => void
  onFieldErrorClear?: (fieldKey: string) => void
}) {
  const sections = props.fields.reduce<Record<string, ChannelDescriptorField[]>>((grouped, field) => {
    const section = field.section ?? 'configuration'
    grouped[section] = [...(grouped[section] ?? []), field]
    return grouped
  }, {})

  return (
    <div className="grid gap-4 border-t border-ink-border pt-4">
      {Object.entries(sections).map(([section, fields]) => {
        const sectionHasErrors = fields.some((field) => Boolean(props.fieldErrors?.[field.key]))
        const fieldsGrid = (
          <div className="grid gap-4 md:grid-cols-3">
            <DescriptorFields
              fields={fields}
              state={props.state}
              descriptor={props.descriptor}
              fieldErrors={props.fieldErrors}
              onChange={props.onChange}
              onFieldErrorClear={props.onFieldErrorClear}
            />
          </div>
        )
        if (section === 'advanced') {
          return (
            <details
              key={`${section}-${sectionHasErrors ? 'errors' : 'clean'}`}
              className="rounded-lg border border-ink-border bg-washi-white px-4 py-3"
              open={sectionHasErrors || undefined}
            >
              <summary className="cursor-pointer select-none">
                <span className="section-title">{sectionLabel(section)}</span>
                <span className="ml-2 text-xs font-normal text-sumi-diluted">Defaults are safe for most users.</span>
              </summary>
              <div className="mt-3">{fieldsGrid}</div>
            </details>
          )
        }
        return (
          <section key={section} className="grid gap-3">
            <p className="section-title">{sectionLabel(section)}</p>
            {fieldsGrid}
          </section>
        )
      })}
    </div>
  )
}

function DescriptorFields(props: {
  fields: ChannelDescriptorField[]
  state: ChannelFormState
  descriptor: ChannelProviderDescriptor
  fieldErrors?: ChannelFieldErrors
  onChange: (updater: (current: ChannelFormState) => ChannelFormState) => void
  onFieldErrorClear?: (fieldKey: string) => void
}) {
  return (
    <>
      {props.fields.map((field) => {
        const key = field.key
        return (
          <DescriptorField
            key={key}
            field={field}
            value={props.state[key]}
            error={props.fieldErrors?.[key]}
            descriptor={props.descriptor}
            onChange={(value) => {
              props.onFieldErrorClear?.(key)
              props.onChange((current) => ({ ...current, [key]: value }))
            }}
          />
        )
      })}
    </>
  )
}

function DescriptorField(props: {
  field: ChannelDescriptorField
  value: ChannelFormValue | undefined
  error?: string
  descriptor: ChannelProviderDescriptor
  onChange: (value: ChannelFormValue) => void
}) {
  const { field } = props
  const key = field.key
  const value = props.value ?? normalizeChannelFormValue(field, props.descriptor.formDefaults[field.key] ?? field.defaultValue ?? '')
  const errorId = `channel-field-${props.descriptor.provider}-${key}-error`
  const helperId = `channel-field-${props.descriptor.provider}-${key}-helper`
  const describedBy = [
    field.helperText ? helperId : null,
    props.error ? errorId : null,
  ].filter(Boolean).join(' ') || undefined
  const requiredMarker = field.required ? (
    <>
      <span aria-hidden="true" className="ml-1 text-accent-vermillion">*</span>
      <span className="sr-only"> required</span>
    </>
  ) : null
  const helperText = field.helperText ? (
    <span id={helperId} className="mt-1 block text-xs leading-5 text-sumi-diluted">{field.helperText}</span>
  ) : null
  const errorText = props.error ? (
    <span id={errorId} className="mt-1 block text-xs font-medium text-accent-vermillion" role="alert">{props.error}</span>
  ) : null

  if (field.kind === 'checkbox') {
    return (
      <div>
        <label className="flex items-center gap-2 text-sm text-sumi-black">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => props.onChange(event.target.checked)}
            className={CHECKBOX_CLASS}
            aria-describedby={describedBy}
            aria-invalid={Boolean(props.error)}
            data-channel-field-key={key}
          />
          <span>{field.label}{requiredMarker}</span>
        </label>
        {helperText}
        {errorText}
      </div>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <label className="block">
        <span className="section-title block">{field.label}{requiredMarker}</span>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => props.onChange(event.target.value)}
          className={`${INPUT_CLASS} min-h-28`}
          placeholder={field.placeholder}
          required={field.required}
          aria-required={field.required}
          aria-invalid={Boolean(props.error)}
          aria-describedby={describedBy}
          data-channel-field-key={key}
        />
        {helperText}
        {errorText}
      </label>
    )
  }

  if (field.kind === 'select') {
    const options = field.options ?? []
    return (
      <label className="block">
        <span className="section-title block">{field.label}{requiredMarker}</span>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => props.onChange(event.target.value)}
          className={INPUT_CLASS}
          required={field.required}
          aria-required={field.required}
          aria-invalid={Boolean(props.error)}
          aria-describedby={describedBy}
          data-channel-field-key={key}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {helperText}
        {errorText}
      </label>
    )
  }

  if (field.kind === 'static' || field.readonly) {
    const text = typeof value === 'string' && value
      ? value
      : field.options?.find((option) => option.value === field.defaultValue)?.label ?? String(field.defaultValue ?? '')
    return (
      <label className="block">
        <span className="section-title block">{field.label}{requiredMarker}</span>
        <div
          className={INPUT_CLASS}
          aria-describedby={describedBy}
          data-channel-field-key={key}
        >
          {text}
        </div>
        {helperText}
        {errorText}
      </label>
    )
  }

  return (
    <label className="block">
      <span className="section-title block">{field.label}{requiredMarker}</span>
      <input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={field.placeholder}
        className={INPUT_CLASS}
        required={field.required}
        aria-required={field.required}
        aria-invalid={Boolean(props.error)}
        aria-describedby={describedBy}
        data-channel-field-key={key}
        type={field.kind === 'password' ? 'password' : field.kind}
        min={field.min}
      />
      {helperText}
      {errorText}
    </label>
  )
}

function BindingRow(props: {
  binding: CommanderChannelBinding
  commanderId: string
  updateBinding: ReturnType<typeof useUpdateChannelBinding>['mutateAsync']
  deleteBinding: (bindingId: string) => Promise<unknown>
}) {
  const { binding, commanderId, updateBinding, deleteBinding } = props
  const [expanded, setExpanded] = useState(false)
  const { data: providerDescriptorResponse } = useChannelProviderDescriptors(commanderId || null)
  const descriptor = providerDescriptorResponse?.providers.find((entry) => entry.provider === binding.provider) ?? null
  const [formState, setFormState] = useState<ChannelFormState>({})
  const [fieldErrors, setFieldErrors] = useState<ChannelFieldErrors>({})
  const [configError, setConfigError] = useState<string | null>(null)
  const shouldPollStatus = providerHasBindingStatus(descriptor)
  const { data: channelStatus } = useChannelStatus(commanderId, binding.id, shouldPollStatus)
  const lastDrop = channelStatus?.lastDrop

  useEffect(() => {
    if (!descriptor) {
      return
    }
    setFormState(formStateFromDescriptor(descriptor, binding))
  }, [binding, descriptor])

  async function saveConfig() {
    if (!descriptor) {
      return
    }
    const validationErrors = getChannelFormFieldErrors(descriptor, formState, {
      existingCredentialConfigured: credentialConfigured,
    })
    const validationError = getFirstChannelFormError(validationErrors)
    if (validationError) {
      setFieldErrors(validationErrors)
      setConfigError(validationError)
      return
    }
    setFieldErrors({})
    setConfigError(null)
    try {
      await updateBinding({
        commanderId,
        bindingId: binding.id,
        displayName: typeof formState.displayName === 'string' && formState.displayName.trim()
          ? formState.displayName.trim()
          : binding.displayName,
        formValues: formState,
      })
      setFormState((current) => {
        const next = { ...current }
        for (const field of descriptor.fields) {
          if (field.secret) {
            next[field.key] = ''
          }
        }
        return next
      })
    } catch (error) {
      const parsed = parseChannelMutationError(error, 'Failed to update channel.')
      setFieldErrors(parsed.fieldErrors)
      setConfigError(parsed.message)
    }
  }

  const credentialConfigured = binding.config?.credentialConfigured === true || binding.config?.accessTokenConfigured === true
  const configurableFields = descriptor?.fields.filter((field) => field.key !== 'accountId') ?? []

  return (
    <div className="rounded-2xl border border-ink-border p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-sumi-black">{binding.displayName}</p>
          <p className="mt-1 font-mono text-xs text-sumi-diluted">
            {binding.provider} · {binding.accountId}
            {credentialConfigured ? ' · credential set' : ''}
            {channelStatus ? ` · ${channelStatus.state}` : ''}
          </p>
          {lastDrop ? (
            <p className="mt-2 text-xs text-accent-vermillion" data-testid={`channel-last-drop-${binding.id}`}>
              Last drop: {lastDrop.reason} · {formatChannelDropTime(lastDrop.at)}
              {lastDrop.chatType ? ` · ${lastDrop.chatType}` : ''}
              {lastDrop.sourceHash ? ` · source ${lastDrop.sourceHash}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {descriptor ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="rounded-lg border border-ink-border px-3 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash"
            >
              Configure
            </button>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-sumi-black">
            <input
              type="checkbox"
              checked={binding.enabled}
              onChange={(event) => {
                void updateBinding({
                  commanderId,
                  bindingId: binding.id,
                  enabled: event.target.checked,
                })
              }}
              className={CHECKBOX_CLASS}
            />
            Enabled
          </label>
          <button
            type="button"
            aria-label={`Remove ${binding.displayName}`}
            onClick={() => {
              void deleteBinding(binding.id)
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-border text-accent-vermillion transition-colors hover:bg-ink-wash"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {descriptor && expanded ? (
        <div className="mt-4 border-t border-ink-border pt-4">
          {channelStatus ? (
            <div className="mb-4 rounded-lg border border-ink-border bg-washi-aged px-3 py-2">
              <p className="section-title">Status</p>
              <p className="mt-1 font-mono text-xs text-sumi-diluted">
                {channelStatus.transport ?? binding.provider}:{channelStatus.state}
              </p>
            </div>
          ) : null}
          <DescriptorFieldSections
            fields={configurableFields}
            state={formState}
            descriptor={descriptor}
            fieldErrors={fieldErrors}
            onChange={(updater) => {
              setFormState((current) => updater(current))
              setConfigError(null)
              setFieldErrors({})
            }}
          />
          {configError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {configError}
            </div>
          ) : null}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                void saveConfig()
              }}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Save size={16} aria-hidden="true" />
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
