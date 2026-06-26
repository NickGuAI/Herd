import { useMemo, useState } from 'react'
import type { PendingApproval } from '@/hooks/use-approvals'
import { SessionRow, type Approval, type Commander, type Worker } from '@modules/command-room/components/desktop/SessionRow'
import { StatusDot } from '@modules/components/herd'

type SessionFilter = 'all' | 'active' | 'waiting'

function isActiveStatus(status: string): boolean {
  // Matches the mock's "active" pill — commander is running, connected, or streaming.
  return ['active', 'connected', 'running'].includes(status)
}

function isWaitingStatus(status: string): boolean {
  return ['paused', 'blocked'].includes(status)
}

function mapApprovals(commander: Commander, approvals: PendingApproval[]): Approval[] {
  return approvals
    .filter((approval) => approval.commanderId === commander.id || approval.commanderName === commander.name)
    .map((approval) => ({
      id: approval.id,
      commanderId: approval.commanderId ?? commander.id,
      workerId: typeof approval.raw.workerId === 'string'
        ? approval.raw.workerId
        : approval.context && typeof approval.context.workerId === 'string'
          ? approval.context.workerId
          : undefined,
      action: approval.actionLabel,
    }))
}

interface MobileSessionsListProps {
  commanders: Commander[]
  selectedCommanderId: string | null
  workers: Worker[]
  approvals: PendingApproval[]
  onSelectCommander: (id: string) => void
}

export function MobileSessionsList({
  commanders,
  selectedCommanderId,
  workers,
  approvals,
  onSelectCommander,
}: MobileSessionsListProps) {
  const [filter, setFilter] = useState<SessionFilter>('all')

  const activeCount = useMemo(
    () => commanders.filter((commander) => isActiveStatus(commander.status)).length,
    [commanders],
  )
  const waitingCount = useMemo(
    () => commanders.filter((commander) => isWaitingStatus(commander.status)).length,
    [commanders],
  )
  const visibleCommanders = useMemo(
    () => commanders.filter((commander) => {
      if (filter === 'active') {
        return isActiveStatus(commander.status)
      }
      if (filter === 'waiting') {
        return isWaitingStatus(commander.status)
      }
      return true
    }),
    [commanders, filter],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-sessions-list">
      <div className="px-5 pb-3 pt-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--hv-fg-subtle)]">herd</p>
            <h1 className="mt-1 font-display text-4xl text-[color:var(--hv-fg)]">Sessions</h1>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 text-[10px] uppercase tracking-[0.14em] text-[color:var(--hv-fg-subtle)]">
          <span className="inline-flex items-center gap-1.5 text-moss-stone">
            <StatusDot state="active" size={6} />
            {activeCount} active
          </span>
          {waitingCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-persimmon">
              <StatusDot state="paused" size={6} />
              {waitingCount} waiting
            </span>
          ) : null}
          <span className="ml-auto text-[color:var(--hv-accent-danger)]">{approvals.length} pend</span>
        </div>

        <div className="mt-4 flex gap-2">
          {(['all', 'active', 'waiting'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className="rounded-[2px_10px_2px_10px] px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] transition-colors"
              style={{
                background: filter === value ? 'var(--hv-fg)' : 'transparent',
                color: filter === value ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
                border: filter === value ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="hv-scroll flex-1 overflow-y-auto px-4 pb-5">
        <div className="space-y-3">
          {visibleCommanders.map((commander) => (
            <div
              key={commander.id}
              className="overflow-hidden rounded-[3px_16px_3px_16px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] shadow-[var(--hv-shadow-whisper)]"
            >
              <SessionRow
                commander={commander}
                selected={selectedCommanderId === commander.id}
                approvals={mapApprovals(commander, approvals)}
                onClick={() => onSelectCommander(commander.id)}
              />
            </div>
          ))}
          {visibleCommanders.length === 0 ? (
            <div className="rounded-[3px_16px_3px_16px] border border-dashed border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-6 text-center text-sm italic text-[color:var(--hv-fg-subtle)]">
              No commanders match this filter.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
