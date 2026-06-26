import { useEffect, useState } from 'react'
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

  if (mode === 'manual') {
    return (
      <div className="space-y-3" data-testid="manual-commander-setup">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setMode('chat')}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
          >
            Chat setup
          </button>
        </div>
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
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
        >
          Manual setup
        </button>
      </div>
      <WizardChatPanel
        onCancel={onClose}
        onCreated={handleWizardCreated}
        onBusyChange={onBusyChange}
      />
    </div>
  )
}
