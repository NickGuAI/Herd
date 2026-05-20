import { useContext, useEffect, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { replicateOrgCommander } from '@modules/org/hooks/useOrgActions'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import type { OrgNode } from '@modules/org/types'
import { Field, FormModal } from '../components'

const INPUT_CLASS =
  'min-h-11 w-full rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-2 text-sm text-[color:var(--hv-fg)] outline-none transition-colors focus:border-[color:var(--hv-field-focus-border)]'
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)] disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60'

type OptionalQueryClient = {
  invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown>
}

interface ReplicateCommanderProps {
  open: boolean
  commanderId: string
  commanderDisplayName: string
  commanders: ReadonlyArray<Pick<OrgNode, 'displayName'>>
  onClose: () => void
  onReplicated: (commanderId: string, displayName: string) => void
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function buildDefaultName(commanderDisplayName: string): string {
  return `${commanderDisplayName.trim()} Copy`.trim()
}

export function ReplicateCommander({
  open,
  commanderId,
  commanderDisplayName,
  commanders,
  onClose,
  onReplicated,
}: ReplicateCommanderProps) {
  const queryClient = useContext(
    QueryClientContext as Parameters<typeof useContext>[0],
  ) as OptionalQueryClient | undefined
  const [displayName, setDisplayName] = useState(buildDefaultName(commanderDisplayName))
  const [isPending, setIsPending] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setDisplayName(buildDefaultName(commanderDisplayName))
    setIsPending(false)
    setGlobalError(null)
  }, [open, commanderDisplayName])

  function requestClose() {
    setIsPending(false)
    setGlobalError(null)
    onClose()
  }

  const trimmedDisplayName = displayName.trim()
  let displayNameError: string | null = null
  if (!trimmedDisplayName) {
    displayNameError = 'Display name is required.'
  } else if (
    commanders.some((commander) => normalizeName(commander.displayName) === normalizeName(trimmedDisplayName))
  ) {
    displayNameError = 'Display name already exists.'
  }

  async function handleSubmit(): Promise<void> {
    if (displayNameError) {
      return
    }

    setIsPending(true)
    setGlobalError(null)
    try {
      const response = await replicateOrgCommander(commanderId, trimmedDisplayName)
      await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
      onReplicated(response.id, trimmedDisplayName)
      requestClose()
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to replicate commander.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <FormModal
      open={open}
      title="Replicate Commander"
      onClose={requestClose}
      bodyTestId="replicate-dialog"
      footer={(
        <>
          <button
            type="button"
            data-testid="replicate-cancel-button"
            onClick={requestClose}
            disabled={isPending}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="replicate-submit-button"
            onClick={() => void handleSubmit()}
            disabled={isPending || Boolean(displayNameError)}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isPending ? 'Replicating...' : 'Replicate'}
          </button>
        </>
      )}
    >
      {globalError ? (
        <div
          data-testid="replicate-commander-error"
          className="rounded-2xl border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-3 text-sm text-[color:var(--hv-accent-danger)]"
        >
          {globalError}
        </div>
      ) : null}

      <p className="text-sm text-[color:var(--hv-fg-subtle)]">
        Create a new commander with the same runtime defaults as {commanderDisplayName}.
      </p>

      <Field
        label="Display Name"
        htmlFor="replicate-displayname-input"
        required
        error={displayNameError}
      >
        <input
          id="replicate-displayname-input"
          data-testid="replicate-displayname-input"
          value={displayName}
          onInput={(event) => setDisplayName(event.currentTarget.value)}
          onChange={(event) => setDisplayName(event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
    </FormModal>
  )
}
