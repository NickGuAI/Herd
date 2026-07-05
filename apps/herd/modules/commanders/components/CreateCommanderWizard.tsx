import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { buildGaiaCreateCommanderPrompt } from '@modules/command-room/gaia-entry-prompts'
import { openGaiaConversationWithDraft } from '@modules/command-room/gaia-launch'
import type { CommanderCreateInput } from '../hooks/useCommander'
import { CreateCommanderForm } from './CreateCommanderForm'
import { WizardChatPanel } from './WizardChatPanel'

interface CreateCommanderWizardProps {
  onAdd: (input: CommanderCreateInput) => Promise<void>
  isPending: boolean
  onClose: () => void
  onWizardCreated?: () => Promise<void> | void
  onBusyChange?: (busy: boolean) => void
}

export function CreateCommanderWizard({
  onAdd,
  isPending,
  onClose,
  onWizardCreated,
  onBusyChange,
}: CreateCommanderWizardProps) {
  const [mode, setMode] = useState<'chat' | 'manual'>('chat')
  const [isOpeningWithGaia, setIsOpeningWithGaia] = useState(false)
  const [gaiaError, setGaiaError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'manual') {
      return
    }
    onBusyChange?.(isPending)
    return () => {
      onBusyChange?.(false)
    }
  }, [isPending, mode, onBusyChange])

  const handleWizardCreated = () => {
    void Promise.resolve(onWizardCreated?.()).catch(() => {})
    onClose()
  }

  async function handleOpenWithGaia(): Promise<void> {
    setIsOpeningWithGaia(true)
    setGaiaError(null)
    try {
      await openGaiaConversationWithDraft(buildGaiaCreateCommanderPrompt())
    } catch (error) {
      setGaiaError(error instanceof Error ? error.message : 'Failed to open Gaia.')
    } finally {
      setIsOpeningWithGaia(false)
    }
  }

  const setupActions = (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => void handleOpenWithGaia()}
        disabled={isOpeningWithGaia}
        className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
      >
        <MessageSquarePlus size={15} className="mr-2 inline" />
        {isOpeningWithGaia ? 'Opening Gaia...' : 'Do it with Gaia'}
      </button>
      <button
        type="button"
        onClick={() => {
          setGaiaError(null)
          setMode(mode === 'manual' ? 'chat' : 'manual')
        }}
        className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
      >
        {mode === 'manual' ? 'Chat setup' : 'Manual setup'}
      </button>
    </div>
  )

  if (mode === 'manual') {
    return (
      <div className="space-y-3" data-testid="manual-commander-setup">
        {setupActions}
        {gaiaError ? <p className="text-sm text-[color:var(--hv-accent-danger)]">{gaiaError}</p> : null}
        <CreateCommanderForm
          onAdd={onAdd}
          isPending={isPending}
          onClose={onClose}
          heading="Manual commander setup"
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {setupActions}
      {gaiaError ? <p className="text-sm text-[color:var(--hv-accent-danger)]">{gaiaError}</p> : null}
      <WizardChatPanel
        onCancel={onClose}
        onCreated={handleWizardCreated}
        onBusyChange={onBusyChange}
      />
    </div>
  )
}
