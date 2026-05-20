import { useContext, useMemo, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useProviderRegistry } from '@/hooks/use-providers'
import type { OrgNode } from '@modules/org/types'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import { createOrgAutomation } from '@modules/org/hooks/useOrgActions'
import {
  NEW_AUTOMATION_CADENCE_PRESET_OPTIONS,
  NEW_AUTOMATION_TRIGGER_OPTIONS,
  listSupportedAutomationProviders,
  useNewAutomationWizardForm,
} from '@modules/org/forms'
import type { NewAutomationCreateRequestBody, NewAutomationOwner } from '@modules/org/forms'
import { EnumSelect, Field, FormModal } from '../components'

const INPUT_CLASS =
  'min-h-11 w-full rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-2 text-sm text-[color:var(--hv-fg)] outline-none transition-colors focus:border-[color:var(--hv-field-focus-border)]'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-28 resize-y`
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)] disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60'

interface NewAutomationWizardProps {
  open: boolean
  owner: NewAutomationOwner
  commanders: ReadonlyArray<OrgNode>
  automations: ReadonlyArray<OrgNode>
  onClose: () => void
  onCreated?: (automationId: string) => void
}

type OptionalQueryClient = {
  invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown>
}

function filterScopedAutomationNames(
  automations: ReadonlyArray<OrgNode>,
  owner: NewAutomationOwner,
): string[] {
  return automations
    .filter((automation) => automation.parentId === owner.id)
    .map((automation) => automation.displayName)
}

export function NewAutomationWizard({
  open,
  owner,
  commanders,
  automations,
  onClose,
  onCreated,
}: NewAutomationWizardProps) {
  const { data: providers = [] } = useProviderRegistry()
  const agentTypeOptions = listSupportedAutomationProviders(providers)
  const queryClient = useContext(
    QueryClientContext as Parameters<typeof useContext>[0],
  ) as OptionalQueryClient | undefined
  const commanderOptions = useMemo(() => [
    { value: '', label: '— Any commander —' },
    ...commanders
      .filter((commander) => commander.kind === 'commander')
      .map((commander) => ({
        value: commander.id,
        label: commander.displayName,
      })),
  ], [commanders])
  const form = useNewAutomationWizardForm({
    existingAutomationNames: filterScopedAutomationNames(automations, owner),
    commanders: commanders
      .filter((commander) => commander.kind === 'commander')
      .map((commander) => ({
        id: commander.id,
        displayName: commander.displayName,
      })),
    defaultQuestCommanderId: owner.kind === 'commander' ? owner.id : '',
  })
  const [isPending, setIsPending] = useState(false)

  function requestClose() {
    form.reset()
    form.setGlobalError(null)
    setIsPending(false)
    onClose()
  }

  async function handleSubmit(): Promise<void> {
    const payload = form.buildCreateRequestBody(owner)
    if (!payload) {
      return
    }

    setIsPending(true)
    form.setGlobalError(null)
    try {
      const created = await createOrgAutomation(payload)
      await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
      onCreated?.(created.id)
      requestClose()
    } catch (error) {
      form.setGlobalError(error instanceof Error ? error.message : 'Failed to create automation.')
    } finally {
      setIsPending(false)
    }
  }

  const ownerLabel = owner.kind === 'commander' && owner.roleLabel
    ? `${owner.displayName} (${owner.roleLabel})`
    : owner.displayName

  return (
    <FormModal
      open={open}
      title={`New Automation for ${owner.displayName}`}
      onClose={requestClose}
      bodyTestId="new-automation-wizard"
      footer={(
        <>
          {form.step !== 'trigger' ? (
            <button
              type="button"
              data-testid="new-automation-back-button"
              onClick={form.goBack}
              disabled={isPending}
              className={SECONDARY_BUTTON_CLASS}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            data-testid="new-automation-close-button"
            onClick={requestClose}
            disabled={isPending}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          {form.step === 'review' ? (
            <button
              type="button"
              data-testid="new-automation-submit-button"
              onClick={() => void handleSubmit()}
              disabled={isPending}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isPending ? 'Creating...' : 'Create'}
            </button>
          ) : (
            <button
              type="button"
              data-testid="new-automation-next-button"
              onClick={form.goNext}
              disabled={isPending}
              className={PRIMARY_BUTTON_CLASS}
            >
              {form.step === 'details' ? 'Review' : 'Next'}
            </button>
          )}
        </>
      )}
    >
      {form.errors.global ? (
        <div className="rounded-2xl border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-3 text-sm text-[color:var(--hv-accent-danger)]">
          {form.errors.global}
        </div>
      ) : null}

      {form.step === 'trigger' ? (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            Choose how this automation should run for {ownerLabel}.
          </p>
          <Field
            label="Trigger"
            htmlFor="new-automation-trigger-select"
            required
            error={form.errors.trigger}
          >
            <EnumSelect
              id="new-automation-trigger-select"
              data-testid="new-automation-trigger-select"
              value={form.values.trigger}
              onChange={(event) => form.updateField('trigger', event.target.value as typeof form.values.trigger)}
              options={NEW_AUTOMATION_TRIGGER_OPTIONS}
            />
          </Field>
        </div>
      ) : null}

      {form.step === 'details' ? (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            Configure the automation payload.
          </p>

          {form.values.trigger === 'schedule' ? (
            <>
              <Field label="Cadence" htmlFor="new-automation-cadence-select">
                <EnumSelect
                  id="new-automation-cadence-select"
                  data-testid="new-automation-cadence-select"
                  value={form.values.cadencePreset}
                  onChange={(event) => form.updateField('cadencePreset', event.target.value as typeof form.values.cadencePreset)}
                  options={NEW_AUTOMATION_CADENCE_PRESET_OPTIONS}
                />
              </Field>

              {form.values.cadencePreset === 'custom' ? (
                <Field
                  label="Cron Expression"
                  htmlFor="new-automation-cron-input"
                  required
                  error={form.errors.cron}
                >
                  <input
                    id="new-automation-cron-input"
                    data-testid="new-automation-cron-input"
                    value={form.values.customCron}
                    onChange={(event) => form.updateField('customCron', event.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>
              ) : null}
            </>
          ) : null}

          {form.values.trigger === 'quest' ? (
            <Field label="Completed Quest From" htmlFor="new-automation-quest-commander-select">
              <EnumSelect
                id="new-automation-quest-commander-select"
                data-testid="new-automation-quest-commander-select"
                value={form.values.questCommanderId}
                onChange={(event) => form.updateField('questCommanderId', event.target.value)}
                options={commanderOptions}
              />
            </Field>
          ) : null}

          <Field
            label="Name"
            htmlFor="new-automation-name-input"
            required
            error={form.errors.name}
          >
            <input
              id="new-automation-name-input"
              data-testid="new-automation-name-input"
              value={form.values.name}
              onChange={(event) => form.updateField('name', event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Instruction"
            htmlFor="new-automation-instruction-input"
            required
            error={form.errors.instruction}
          >
            <textarea
              id="new-automation-instruction-input"
              data-testid="new-automation-instruction-input"
              value={form.values.instruction}
              onChange={(event) => form.updateField('instruction', event.target.value)}
              className={TEXTAREA_CLASS}
            />
          </Field>

          <Field label="Agent Type" htmlFor="new-automation-agent-type-select">
            <EnumSelect
              id="new-automation-agent-type-select"
              data-testid="new-automation-agent-type-select"
              value={form.values.agentType}
              onChange={(event) => form.updateField('agentType', event.target.value as typeof form.values.agentType)}
              options={agentTypeOptions}
            />
          </Field>
        </div>
      ) : null}

      {form.step === 'review' ? (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            Review the automation before creating it.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Owner</dt>
              <dd className="mt-1 text-sm text-[color:var(--hv-fg)]">{ownerLabel}</dd>
            </div>
            <div className="rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Trigger</dt>
              <dd className="mt-1 text-sm text-[color:var(--hv-fg)]">{form.values.trigger}</dd>
            </div>
            <div className="rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Name</dt>
              <dd className="mt-1 text-sm text-[color:var(--hv-fg)]">{form.values.name}</dd>
            </div>
            <div className="rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Agent</dt>
              <dd className="mt-1 text-sm text-[color:var(--hv-fg)]">{form.values.agentType}</dd>
            </div>
            <div className="rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3 sm:col-span-2">
              <dt className="text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">Instruction</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-[color:var(--hv-fg)]">
                {form.values.instruction}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </FormModal>
  )
}
