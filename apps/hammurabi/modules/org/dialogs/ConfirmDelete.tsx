import { useContext, useEffect, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import {
  archiveOrgCommander,
  deleteOrgCommander,
} from '@modules/org/hooks/useOrgActions'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import { Field, FormModal } from '../components'

const INPUT_CLASS =
  'min-h-11 w-full rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-2 text-sm text-[color:var(--hv-fg)] outline-none transition-colors focus:border-[color:var(--hv-field-focus-border)]'
const DANGER_BUTTON_CLASS =
  'rounded-full bg-[var(--hv-accent-danger-wash)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-accent-danger-wash)] disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)] disabled:cursor-not-allowed disabled:opacity-60'
const REFUSE_BUTTON_CLASS =
  'rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)]'

type DeleteStep = 1 | 2 | 3 | 4

type OptionalQueryClient = {
  invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown>
}

interface ConfirmDeleteProps {
  open: boolean
  commanderId: string
  commanderDisplayName: string
  onClose: () => void
  onDeleted: () => void
  onArchived: () => void
  onOpenCommandRoom: () => void
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Request failed (409):')
}

function isConflictMessage(message: string | null): boolean {
  return typeof message === 'string' && message.includes('Request failed (409):')
}

export function ConfirmDelete({
  open,
  commanderId,
  commanderDisplayName,
  onClose,
  onDeleted,
  onArchived,
  onOpenCommandRoom,
}: ConfirmDeleteProps) {
  const queryClient = useContext(
    QueryClientContext as Parameters<typeof useContext>[0],
  ) as OptionalQueryClient | undefined
  const archiveButtonRef = useRef<HTMLButtonElement>(null)
  const pendingActionRef = useRef(false)
  const [step, setStep] = useState<DeleteStep>(1)
  const [confirmation, setConfirmation] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setStep(1)
    setConfirmation('')
    pendingActionRef.current = false
    setIsPending(false)
    setGlobalError(null)
  }, [open, commanderId])

  useEffect(() => {
    if (open && step === 4) {
      archiveButtonRef.current?.focus()
    }
  }, [open, step])

  function requestClose() {
    pendingActionRef.current = false
    setIsPending(false)
    setGlobalError(null)
    setConfirmation('')
    setStep(1)
    onClose()
  }

  const canConfirmName = confirmation.trim() === commanderDisplayName
  const showRefuseVariant = isConflictMessage(globalError)

  async function invalidateOrg(): Promise<void> {
    await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
  }

  async function handleArchive(): Promise<void> {
    if (isPending || pendingActionRef.current) {
      return
    }
    pendingActionRef.current = true
    setIsPending(true)
    setGlobalError(null)
    try {
      await archiveOrgCommander(commanderId)
      await invalidateOrg()
      onArchived()
      requestClose()
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Failed to archive commander.'
      if (isConflictError(error)) {
        setConfirmation('')
      }
      setGlobalError(nextMessage)
    } finally {
      pendingActionRef.current = false
      setIsPending(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (isPending || pendingActionRef.current) {
      return
    }
    pendingActionRef.current = true
    setIsPending(true)
    setGlobalError(null)
    try {
      await deleteOrgCommander(commanderId)
      await invalidateOrg()
      onDeleted()
      requestClose()
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Failed to delete commander.'
      if (isConflictError(error)) {
        setConfirmation('')
      }
      setGlobalError(nextMessage)
    } finally {
      pendingActionRef.current = false
      setIsPending(false)
    }
  }

  function handleOpenCommandRoom() {
    onOpenCommandRoom()
    requestClose()
  }

  function renderBody() {
    if (showRefuseVariant) {
      return (
        <div data-testid="delete-commander-refuse-modal" className="space-y-3">
          <p className="text-sm text-[color:var(--hv-fg)]">
            {commanderDisplayName} is still active. Open the command room to stop or hand off the live run before changing this commander.
          </p>
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            The org surface will not archive or delete a running commander.
          </p>
        </div>
      )
    }

    if (step === 1) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-[color:var(--hv-fg)]">
            Delete {commanderDisplayName} permanently? This cannot be undone.
          </p>
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            The next steps require explicit confirmation before any permanent delete is available.
          </p>
        </div>
      )
    }

    if (step === 2) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-[color:var(--hv-fg)]">
            Are you absolutely sure?
          </p>
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            Permanent delete removes memory, transcripts, configuration, and all commander history.
          </p>
        </div>
      )
    }

    if (step === 3) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--hv-fg)]">
            Final warning. Type the commander name to confirm.
          </p>
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            Type <span className="font-mono text-[color:var(--hv-fg)]">{commanderDisplayName}</span>.
          </p>
          <Field
            label="Commander Name"
            htmlFor="delete-commander-confirm-input"
          >
            <input
              id="delete-commander-confirm-input"
              data-testid="delete-commander-confirm-input"
              value={confirmation}
              onInput={(event) => setConfirmation(event.currentTarget.value)}
              onChange={(event) => setConfirmation(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <p className="text-sm text-[color:var(--hv-fg)]">
          Or archive instead? Archive is recommended because it preserves memory and transcripts for restore.
        </p>
        <p className="text-sm text-[color:var(--hv-fg-subtle)]">
          Archived commanders are hidden from the default org view and can be restored from the archived view.
        </p>
      </div>
    )
  }

  function renderFooter() {
    if (showRefuseVariant) {
      return (
        <>
          <button
            type="button"
            data-testid="delete-commander-cancel-button"
            onClick={requestClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="delete-commander-open-room-button"
            onClick={handleOpenCommandRoom}
            className={REFUSE_BUTTON_CLASS}
          >
            Open /command-room
          </button>
        </>
      )
    }

    if (step === 4) {
      return (
        <>
          <button
            ref={archiveButtonRef}
            type="button"
            data-testid="delete-commander-archive-button"
            onClick={() => void handleArchive()}
            disabled={isPending}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isPending ? 'Archiving...' : 'Archive'}
          </button>
          <button
            type="button"
            data-testid="delete-commander-permanent-button"
            onClick={() => void handleDelete()}
            disabled={isPending}
            className={DANGER_BUTTON_CLASS}
          >
            Permanently Delete
          </button>
        </>
      )
    }

    return (
      <>
        <button
          type="button"
          data-testid="delete-commander-cancel-button"
          onClick={requestClose}
          disabled={isPending}
          className={SECONDARY_BUTTON_CLASS}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="delete-commander-continue-button"
          onClick={() => setStep((current) => (current === 3 ? 4 : ((current + 1) as DeleteStep)))}
          disabled={isPending || (step === 3 && !canConfirmName)}
          className={step === 3 ? DANGER_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
        >
          {step === 3 ? 'Confirm' : 'Continue'}
        </button>
      </>
    )
  }

  return (
    <FormModal
      open={open}
      title="Delete Commander"
      onClose={requestClose}
      bodyTestId="delete-commander-modal"
      footer={renderFooter()}
    >
      {globalError && !showRefuseVariant ? (
        <div
          data-testid="confirm-delete-error"
          className="mb-4 rounded-2xl border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-3 text-sm text-[color:var(--hv-accent-danger)]"
        >
          {globalError}
        </div>
      ) : null}

      {renderBody()}
    </FormModal>
  )
}
