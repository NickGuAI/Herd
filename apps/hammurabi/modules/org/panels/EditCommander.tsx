import { useContext, useEffect, useState } from 'react'
import { QueryClientContext, type QueryClient } from '@tanstack/react-query'
import { useProviderRegistry } from '@/hooks/use-providers'
import { DEFAULT_CLAUDE_EFFORT_LEVEL, type ClaudeEffortLevel } from '@modules/claude-effort.js'
import { COMMANDERS_QUERY_KEY, generateCommanderAvatar } from '@modules/commanders/hooks/useCommander'
import {
  COMMANDER_PORTRAIT_STYLE_OPTIONS,
  DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
  getCommanderPortraitStyle,
  parseCommanderPortraitStyleId,
  type CommanderPortraitStyleId,
} from '@modules/commanders/portrait-styles'
import {
  HIRE_COMMANDER_EFFORT_OPTIONS,
  listSupportedCommanderConversationProviders,
  type OrgAgentType,
} from '@modules/org/forms'
import {
  fetchOrgCommanderDetail,
  type OrgCommanderDetail,
  updateOrgCommander,
} from '@modules/org/hooks/useOrgActions'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import type { OrgNode, OrgTree } from '@modules/org/types'
import { ConfirmModal, EnumSelect, Field, FormModal } from '../components'

const INPUT_CLASS =
  'min-h-11 w-full rounded-2xl border border-[color:var(--hv-field-border)] bg-[var(--hv-field-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg)] outline-none transition-colors placeholder:text-[color:var(--hv-field-placeholder)] focus:border-[color:var(--hv-field-focus-border)]'
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-button-primary-fg)] transition-colors hover:bg-[var(--hv-button-primary-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-[color:var(--hv-button-ghost-border)] px-4 py-2 text-sm text-[color:var(--hv-button-ghost-fg)] transition-colors hover:bg-[var(--hv-button-ghost-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60'
const METADATA_CARD_CLASS =
  'rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3'

type CommanderContextMode = 'thin' | 'fat'

interface EditCommanderProps {
  open: boolean
  commanderId: string
  commanderDisplayName: string
  commanders: ReadonlyArray<Pick<OrgNode, 'id' | 'displayName'>>
  fallbackOperatorId?: string | null
  onClose: () => void
  onUpdated?: (displayName: string) => void
}

interface EditCommanderValues {
  displayName: string
  agentType: OrgAgentType
  effort: ClaudeEffortLevel
  cwd: string
  maxTurns: string
  contextMode: CommanderContextMode
  portraitStyleId: CommanderPortraitStyleId
}

interface EditCommanderMetadata {
  id: string
  operatorId: string | null
  createdAt: string | null
  templateId: string | null
  replicatedFromCommanderId: string | null
}

function commanderAvatarFallback(displayName: string): string {
  const [first = 'C', second = 'M'] = displayName.trim().split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function buildFormValues(
  detail: OrgCommanderDetail,
  commanderDisplayName: string,
): EditCommanderValues {
  return {
    displayName: detail.displayName?.trim() || commanderDisplayName,
    agentType: detail.agentType ?? 'claude',
    effort: detail.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
    cwd: detail.cwd ?? '',
    maxTurns: typeof detail.maxTurns === 'number' && Number.isInteger(detail.maxTurns)
      ? String(detail.maxTurns)
      : '1',
    contextMode: detail.contextMode === 'thin' ? 'thin' : 'fat',
    portraitStyleId: detail.ui?.portraitStyleId ?? DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
  }
}

function buildMetadata(
  detail: OrgCommanderDetail,
  fallbackOperatorId?: string | null,
): EditCommanderMetadata {
  return {
    id: detail.id,
    operatorId: detail.operatorId ?? fallbackOperatorId ?? null,
    createdAt: detail.createdAt ?? detail.created ?? null,
    templateId: detail.templateId ?? null,
    replicatedFromCommanderId: detail.replicatedFromCommanderId ?? null,
  }
}

function isValidAgentType(
  options: ReadonlyArray<{ value: OrgAgentType }>,
  value: string,
): value is OrgAgentType {
  return options.some((option) => option.value === value)
}

function isValidEffort(value: string): value is ClaudeEffortLevel {
  return HIRE_COMMANDER_EFFORT_OPTIONS.some((option) => option.value === value)
}

function isValidPortraitStyleId(value: string): value is CommanderPortraitStyleId {
  return parseCommanderPortraitStyleId(value) !== null
}

function toUserFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback
  }

  const requestFailureMatch = error.message.match(/^Request failed \(\d+\):\s*(.+)$/)
  if (requestFailureMatch) {
    try {
      const parsed = JSON.parse(requestFailureMatch[1]) as { error?: unknown }
      if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        return parsed.error.trim()
      }
    } catch {
      // Fall back to the raw message below.
    }
  }

  return error.message
}

function withCacheBust(url: string, timestamp: number): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${timestamp}`
}

function updateOrgTreeAvatarUrl(
  tree: OrgTree | undefined,
  commanderId: string,
  avatarUrl: string,
): OrgTree | undefined {
  if (!tree) {
    return tree
  }

  return {
    ...tree,
    commanders: tree.commanders.map((commander) => (
      commander.id === commanderId
        ? { ...commander, avatarUrl }
        : commander
    )),
  }
}

export function EditCommander({
  open,
  commanderId,
  commanderDisplayName,
  commanders,
  fallbackOperatorId,
  onClose,
  onUpdated,
}: EditCommanderProps) {
  const { data: providers = [] } = useProviderRegistry()
  const agentTypeOptions = listSupportedCommanderConversationProviders(providers)
  const queryClient = useContext(
    QueryClientContext as Parameters<typeof useContext>[0],
  ) as QueryClient | undefined

  const [initialValues, setInitialValues] = useState<EditCommanderValues | null>(null)
  const [values, setValues] = useState<EditCommanderValues | null>(null)
  const [metadata, setMetadata] = useState<EditCommanderMetadata | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [maxTurnsLimit, setMaxTurnsLimit] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false)
  const [isGenerateAvatarConfirmOpen, setIsGenerateAvatarConfirmOpen] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setIsLoading(true)
    setIsPending(false)
    setIsGeneratingAvatar(false)
    setIsGenerateAvatarConfirmOpen(false)
    setAvatarError(null)
    setAvatarPreviewUrl(null)
    setGlobalError(null)

    void fetchOrgCommanderDetail(commanderId)
      .then((detail) => {
        if (cancelled) {
          return
        }

        const nextValues = buildFormValues(detail, commanderDisplayName)
        setInitialValues(nextValues)
        setValues(nextValues)
        setMetadata(buildMetadata(detail, fallbackOperatorId))
        setAvatarPreviewUrl(detail.avatarUrl ?? null)
        setMaxTurnsLimit(
          typeof detail.runtimeConfig?.limits?.maxTurns === 'number'
            ? detail.runtimeConfig.limits.maxTurns
            : null,
        )
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setInitialValues(null)
        setValues(null)
        setMetadata(null)
        setAvatarPreviewUrl(null)
        setGlobalError(error instanceof Error ? error.message : 'Failed to load commander details.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, commanderId, commanderDisplayName, fallbackOperatorId])

  function requestClose() {
    setIsPending(false)
    setIsGeneratingAvatar(false)
    setIsGenerateAvatarConfirmOpen(false)
    setAvatarError(null)
    setGlobalError(null)
    onClose()
  }

  function updateField<TKey extends keyof EditCommanderValues>(
    field: TKey,
    nextValue: EditCommanderValues[TKey],
  ) {
    setValues((current) => (current ? { ...current, [field]: nextValue } : current))
  }

  const displayName = values?.displayName ?? ''
  const trimmedDisplayName = displayName.trim()
  const maxTurnsValue = values?.maxTurns ?? ''
  const parsedMaxTurns = Number.parseInt(maxTurnsValue, 10)
  const hasIntegerMaxTurns = Number.isInteger(parsedMaxTurns) && String(parsedMaxTurns) === maxTurnsValue.trim()

  let displayNameError: string | null = null
  if (!trimmedDisplayName) {
    displayNameError = 'Display name is required.'
  } else if (
    commanders.some((commander) =>
      commander.id !== commanderId
      && normalizeName(commander.displayName) === normalizeName(trimmedDisplayName))
  ) {
    displayNameError = 'Display name already exists.'
  }

  let maxTurnsError: string | null = null
  if (!maxTurnsValue.trim()) {
    maxTurnsError = 'Max turns is required.'
  } else if (!hasIntegerMaxTurns || parsedMaxTurns < 1) {
    maxTurnsError = 'Max turns must be an integer greater than or equal to 1.'
  } else if (typeof maxTurnsLimit === 'number' && parsedMaxTurns > maxTurnsLimit) {
    maxTurnsError = `Max turns must be ${maxTurnsLimit} or fewer.`
  }

  const isFormValid = !displayNameError && !maxTurnsError

  const isDirty = Boolean(
    initialValues
    && values
    && (
      normalizeName(values.displayName) !== normalizeName(initialValues.displayName)
      || values.agentType !== initialValues.agentType
      || values.effort !== initialValues.effort
      || values.cwd.trim() !== initialValues.cwd.trim()
      || parsedMaxTurns !== Number.parseInt(initialValues.maxTurns, 10)
      || values.contextMode !== initialValues.contextMode
      || values.portraitStyleId !== initialValues.portraitStyleId
    ),
  )

  const avatarFallback = commanderAvatarFallback(trimmedDisplayName || commanderDisplayName)
  const selectedPortraitStyle = getCommanderPortraitStyle(
    values?.portraitStyleId ?? DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
  )

  async function handleGenerateAvatar(): Promise<void> {
    setIsGenerateAvatarConfirmOpen(false)
    setAvatarError(null)
    setIsGeneratingAvatar(true)

    try {
      const { avatarUrl } = await generateCommanderAvatar({
        commanderId,
        styleId: values?.portraitStyleId ?? DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
      })
      const refreshedDetail = await fetchOrgCommanderDetail(commanderId).catch(() => null)
      const timestamp = Date.now()
      const resolvedAvatarUrl = refreshedDetail?.avatarUrl ?? avatarUrl
      const cacheBustedAvatarUrl = withCacheBust(resolvedAvatarUrl, timestamp)

      setAvatarPreviewUrl(cacheBustedAvatarUrl)
      await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
      await queryClient?.invalidateQueries({ queryKey: COMMANDERS_QUERY_KEY })
      queryClient?.setQueriesData<OrgTree>(
        { queryKey: ORG_QUERY_KEY },
        (current) => updateOrgTreeAvatarUrl(current, commanderId, cacheBustedAvatarUrl),
      )
    } catch (error) {
      setAvatarError(toUserFacingError(error, 'Failed to generate avatar.'))
    } finally {
      setIsGeneratingAvatar(false)
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!values || !initialValues || !isFormValid || !isDirty) {
      return
    }

    const payload: Record<string, string | number> = {}
    const trimmedCwd = values.cwd.trim()

    if (normalizeName(values.displayName) !== normalizeName(initialValues.displayName)) {
      payload.displayName = trimmedDisplayName
    }
    if (values.agentType !== initialValues.agentType) {
      payload.agentType = values.agentType
    }
    if (values.effort !== initialValues.effort) {
      payload.effort = values.effort
    }
    if (trimmedCwd !== initialValues.cwd.trim()) {
      payload.cwd = trimmedCwd
    }
    if (parsedMaxTurns !== Number.parseInt(initialValues.maxTurns, 10)) {
      payload.maxTurns = parsedMaxTurns
    }
    if (values.contextMode !== initialValues.contextMode) {
      payload.contextMode = values.contextMode
    }
    if (values.portraitStyleId !== initialValues.portraitStyleId) {
      payload.portraitStyleId = values.portraitStyleId
    }

    setIsPending(true)
    setGlobalError(null)
    try {
      await updateOrgCommander(commanderId, payload)
      await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
      await queryClient?.invalidateQueries({ queryKey: COMMANDERS_QUERY_KEY })
      onUpdated?.(trimmedDisplayName)
      requestClose()
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to update commander.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
      <FormModal
        open={open}
        title="Edit Commander"
        onClose={requestClose}
        bodyTestId="edit-commander-panel"
        footer={(
          <>
            <button
              type="button"
              data-testid="edit-commander-cancel-button"
              onClick={requestClose}
              disabled={isPending}
              className={SECONDARY_BUTTON_CLASS}
            >
              Close
            </button>
            <button
              type="button"
              data-testid="edit-commander-save-button"
              onClick={() => void handleSubmit()}
              disabled={isLoading || isPending || !isDirty || !isFormValid}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isPending ? 'Saving...' : 'Save changes'}
            </button>
          </>
        )}
      >
        {globalError ? (
          <div
            data-testid="edit-commander-error"
            className="rounded-2xl border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-3 text-sm text-[color:var(--hv-accent-danger)]"
          >
            {globalError}
          </div>
        ) : null}

        {isLoading ? (
          <p data-testid="edit-commander-loading" className="text-sm text-[color:var(--hv-fg-muted)]">
            Loading commander details...
          </p>
        ) : !values || !metadata ? (
          <p data-testid="edit-commander-load-failed" className="text-sm text-[color:var(--hv-fg-muted)]">
            Commander details are unavailable right now.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-4">
              <p className="text-sm text-[color:var(--hv-fg-muted)]">
                Update commander identity and runtime defaults without leaving the org page.
              </p>

              <div
                data-testid="edit-commander-portrait-panel"
                className="flex flex-col gap-4 rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-4 text-[color:var(--hv-fg)] shadow-[var(--hv-shadow-whisper)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-4">
                  {avatarPreviewUrl ? (
                    <img
                      data-testid="edit-commander-avatar-preview"
                      src={avatarPreviewUrl}
                      alt={`${trimmedDisplayName || commanderDisplayName} avatar`}
                      className="h-20 w-20 rounded-full border border-[color:var(--hv-border-soft)] object-cover"
                    />
                  ) : (
                    <div
                      data-testid="edit-commander-avatar-fallback"
                      className="flex h-20 w-20 items-center justify-center rounded-full border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-raised)] text-base font-medium text-[color:var(--hv-fg)]"
                    >
                      {avatarFallback}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">
                      Portrait
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--hv-fg)]">
                      Generate a fresh {selectedPortraitStyle.label} portrait from this commander&apos;s `COMMANDER.md`.
                    </p>
                  </div>
                </div>

                <div className="grid w-full gap-3 sm:w-64">
                  <Field label="Portrait Style" htmlFor="edit-commander-portrait-style-select">
                    <EnumSelect
                      id="edit-commander-portrait-style-select"
                      data-testid="edit-commander-portrait-style-select"
                      value={values.portraitStyleId}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        if (isValidPortraitStyleId(nextValue)) {
                          updateField('portraitStyleId', nextValue)
                        }
                      }}
                      options={COMMANDER_PORTRAIT_STYLE_OPTIONS}
                    />
                  </Field>

                  <button
                    type="button"
                    data-testid="edit-commander-generate-avatar-button"
                    onClick={() => setIsGenerateAvatarConfirmOpen(true)}
                    disabled={isLoading || isPending || isGeneratingAvatar}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    {isGeneratingAvatar ? 'Generating...' : 'Generate avatar'}
                  </button>
                </div>
              </div>

              {avatarError ? (
                <div
                  data-testid="edit-commander-avatar-error"
                  className="rounded-2xl border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-3 text-sm text-[color:var(--hv-accent-danger)]"
                >
                  {avatarError}
                </div>
              ) : null}

              <Field
                label="Display Name"
                htmlFor="edit-commander-displayname-input"
                required
                error={displayNameError}
              >
                <input
                  id="edit-commander-displayname-input"
                  data-testid="edit-commander-displayname-input"
                  value={values.displayName}
                  onChange={(event) => updateField('displayName', event.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Agent Type" htmlFor="edit-commander-agent-type-select">
                  <EnumSelect
                    id="edit-commander-agent-type-select"
                    data-testid="edit-commander-agent-select"
                    value={values.agentType}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      if (isValidAgentType(agentTypeOptions, nextValue)) {
                        updateField('agentType', nextValue)
                      }
                    }}
                    options={agentTypeOptions}
                  />
                </Field>

                <Field label="Effort" htmlFor="edit-commander-effort-select">
                  <EnumSelect
                    id="edit-commander-effort-select"
                    data-testid="edit-commander-effort-select"
                    value={values.effort}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      if (isValidEffort(nextValue)) {
                        updateField('effort', nextValue)
                      }
                    }}
                    options={HIRE_COMMANDER_EFFORT_OPTIONS}
                  />
                </Field>
              </div>

              <Field label="Working Directory" htmlFor="edit-commander-cwd-input">
                <input
                  id="edit-commander-cwd-input"
                  data-testid="edit-commander-cwd-input"
                  value={values.cwd}
                  onChange={(event) => updateField('cwd', event.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Max Turns"
                  htmlFor="edit-commander-maxturns-input"
                  required
                  error={maxTurnsError}
                >
                  <input
                    id="edit-commander-maxturns-input"
                    data-testid="edit-commander-maxturns-input"
                    type="number"
                    min={1}
                    max={maxTurnsLimit ?? undefined}
                    value={values.maxTurns}
                    onChange={(event) => updateField('maxTurns', event.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Context Mode" htmlFor="edit-commander-context-mode-select">
                  <EnumSelect
                    id="edit-commander-context-mode-select"
                    data-testid="edit-commander-context-mode-select"
                    value={values.contextMode}
                    onChange={(event) => updateField(
                      'contextMode',
                      event.target.value === 'thin' ? 'thin' : 'fat',
                    )}
                    options={[
                      { value: 'fat', label: 'Fat' },
                      { value: 'thin', label: 'Thin' },
                    ]}
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-medium text-[color:var(--hv-fg)]">Metadata</h2>
              <dl
                data-testid="edit-commander-metadata"
                className="grid gap-3 sm:grid-cols-2"
              >
                <div className={METADATA_CARD_CLASS}>
                  <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">ID</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-[color:var(--hv-fg)]">{metadata.id}</dd>
                </div>
                <div className={METADATA_CARD_CLASS}>
                  <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Operator ID</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-[color:var(--hv-fg)]">{metadata.operatorId ?? '—'}</dd>
                </div>
                <div className={METADATA_CARD_CLASS}>
                  <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Created At</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-[color:var(--hv-fg)]">{metadata.createdAt ?? '—'}</dd>
                </div>
                <div className={METADATA_CARD_CLASS}>
                  <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Template ID</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-[color:var(--hv-fg)]">{metadata.templateId ?? '—'}</dd>
                </div>
                <div className={`${METADATA_CARD_CLASS} sm:col-span-2`}>
                  <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">
                    Replicated From Commander ID
                  </dt>
                  <dd className="mt-1 break-all font-mono text-sm text-[color:var(--hv-fg)]">
                    {metadata.replicatedFromCommanderId ?? '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </FormModal>

      <ConfirmModal
        open={isGenerateAvatarConfirmOpen}
        title="Generate avatar"
        message={`Generate a ${selectedPortraitStyle.label} avatar from this commander's COMMANDER.md? This will overwrite the current avatar.`}
        confirmLabel="Generate now"
        bodyTestId="edit-commander-generate-avatar-confirm-modal"
        onClose={() => setIsGenerateAvatarConfirmOpen(false)}
        onConfirm={() => {
          void handleGenerateAvatar()
        }}
      />
    </>
  )
}
