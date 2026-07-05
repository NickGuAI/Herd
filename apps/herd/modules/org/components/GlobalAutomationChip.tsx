import { ChevronRight, Zap } from 'lucide-react'
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
      className="card-sumi flex w-full appearance-none items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--hv-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]">
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
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--hv-fg-subtle)]" aria-hidden="true" />
    </button>
  )
}
