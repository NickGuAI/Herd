import { useMemo, useState } from 'react'
import type { PendingApproval } from '@/hooks/use-approvals'
import { SessionRow, type Approval, type Commander, type Worker } from '@modules/command-room/components/desktop/SessionRow'
import { StatusDot } from '@modules/components/hervald'

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
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--hv-bg)]" data-testid="mobile-sessions-list">
      <div className="border-b border-[color:var(--hv-border-hair)] px-4 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-medium leading-7 text-[color:var(--hv-fg)]">Sessions</h1>
            <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--hv-fg-subtle)]">
              <span className="inline-flex items-center gap-1.5 text-moss-stone">
                <StatusDot state="active" size={5} />
                {activeCount} active
              </span>
              {waitingCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-persimmon">
                  <StatusDot state="paused" size={5} />
                  {waitingCount} waiting
                </span>
              ) : null}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--hv-accent-danger-wash)] px-2 py-1 text-[10px] font-medium text-[color:var(--hv-accent-danger)]">
            {approvals.length} pending
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] p-1">
          {(['all', 'active', 'waiting'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className="min-h-8 rounded-md px-2 text-[11px] font-medium capitalize transition-colors"
              style={{
                background: filter === value ? 'var(--hv-fg)' : 'transparent',
                color: filter === value ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="hv-scroll flex-1 overflow-y-auto px-3 pb-4 pt-3">
        <div className="space-y-2.5">
          {visibleCommanders.map((commander) => (
            <div
              key={commander.id}
              className="overflow-hidden rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] shadow-[var(--hv-shadow-whisper)]"
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
            <div className="rounded-lg border border-dashed border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-6 text-center text-sm text-[color:var(--hv-fg-subtle)]">
              No commanders match this filter.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
