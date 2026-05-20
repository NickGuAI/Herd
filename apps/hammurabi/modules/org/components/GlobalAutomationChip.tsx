import { Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function GlobalAutomationChip({
  activeCount,
}: {
  activeCount: number
}) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      data-testid="global-automation-chip"
      onClick={() => navigate('/automations?commander=global')}
      className="flex w-full items-center justify-between gap-4 rounded-[16px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-5 py-4 text-left transition-colors hover:bg-[var(--hv-surface-hover)]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hv-surface-selected)] text-[color:var(--hv-fg)]">
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-medium text-[color:var(--hv-fg)]">
            Global Automation · {activeCount} active
          </span>
          <span className="mt-1 block text-sm text-[color:var(--hv-fg-subtle)]">
            Automation page
          </span>
        </span>
      </span>
      <span className="shrink-0 text-lg text-[color:var(--hv-fg-subtle)]" aria-hidden="true">→</span>
    </button>
  )
}
