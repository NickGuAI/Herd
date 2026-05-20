import { Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OrgNode } from '../types'

export function AutomationsCard({
  commander,
  automationCount,
}: {
  commander: OrgNode
  automationCount: number
}) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      data-testid="commander-automations-card"
      data-commander-id={commander.id}
      onClick={() => navigate(`/automations?commander=${encodeURIComponent(commander.id)}`)}
      className="card-sumi flex h-full min-h-40 flex-col justify-between gap-4 p-5 text-left transition-colors hover:bg-[var(--hv-surface-hover)]"
    >
      <span>
        <span className="section-title block">Automations</span>
        <span className="mt-1 block text-sm text-[color:var(--hv-fg-subtle)]">Commander-scoped runs</span>
      </span>
      <span className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--hv-border-hair)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)]">
          <Zap size={14} aria-hidden="true" />
          {automationCount} automations
        </span>
        <span className="text-lg text-[color:var(--hv-fg-subtle)]" aria-hidden="true">→</span>
      </span>
    </button>
  )
}
