import { useState } from 'react'
import { AlertTriangle, Check, Loader2, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import {
  type ApprovalHistoryEntry,
  type PendingApproval,
  useApprovalDecision,
  useApprovalHistory,
  usePendingApprovals,
} from '@/hooks/use-approvals'
import { cn, timeAgo } from '@/lib/utils'
import ApprovalCard from './ApprovalCard'
import ApprovalSheet from './ApprovalSheet'

function formatSourceLabel(source: string): string {
  const normalized = source.trim().toLowerCase()
  if (normalized === 'codex') {
    return 'Codex'
  }
  if (normalized === 'claude') {
    return 'Claude'
  }
  if (normalized === 'approval') {
    return 'Queue'
  }
  return source.replace(/[-_]+/g, ' ')
}

function EmptyState() {
  return (
    <div className="card-sumi px-5 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-washi-aged/70 text-sumi-diluted">
        <ShieldCheck size={20} />
      </div>
      <h3 className="mt-4 font-display text-heading text-sumi-black">Nothing waiting</h3>
      <p className="mt-2 text-sm leading-relaxed text-sumi-diluted">
        New approval requests will appear here as soon as agents pause for review.
      </p>
    </div>
  )
}

function HistoryDecisionBadge({ entry }: { entry: ApprovalHistoryEntry }) {
  const label = entry.type === 'approval.enqueued'
    ? 'Queued'
    : entry.timedOut
      ? 'Timed Out'
      : entry.decision === 'approve'
        ? 'Approved'
        : 'Rejected'
  const badgeClassName = entry.type === 'approval.enqueued'
    ? 'badge-idle'
    : entry.decision === 'approve'
      ? 'badge-active'
      : 'badge-stale'

  return <span className={cn('badge-sumi', badgeClassName)}>{label}</span>
}

function ApprovalHistoryCard({ entry }: { entry: ApprovalHistoryEntry }) {
  return (
    <article className="rounded-xl border border-ink-border/60 bg-washi-aged px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-sumi-black">{entry.actionLabel}</h3>
            <HistoryDecisionBadge entry={entry} />
          </div>
          <p className="mt-1 text-xs text-sumi-diluted">
            {(entry.commanderId ?? 'Unknown agent')}
            {entry.source ? ` · ${formatSourceLabel(entry.source)}` : ''}
            {' · '}
            {timeAgo(entry.timestamp)}
          </p>
        </div>
      </div>

      {entry.summary && (
        <p className="mt-3 text-sm leading-relaxed text-sumi-gray">{entry.summary}</p>
      )}
    </article>
  )
}

export default function ApprovalsPage() {
  const [previewApproval, setPreviewApproval] = useState<PendingApproval | null>(null)
  const [panelMessage, setPanelMessage] = useState<string | null>(null)
  const pendingApprovalsQuery = usePendingApprovals()
  const approvalHistoryQuery = useApprovalHistory()
  const decisionMutation = useApprovalDecision()

  const pendingApprovals = pendingApprovalsQuery.data ?? []
  const approvalHistory = approvalHistoryQuery.data ?? []
  const pendingCount = pendingApprovals.length
  const listError = pendingApprovalsQuery.error instanceof Error
    ? pendingApprovalsQuery.error.message
    : null
  const historyError = approvalHistoryQuery.error instanceof Error
    ? approvalHistoryQuery.error.message
    : null
  const mutationError = decisionMutation.error instanceof Error
    ? decisionMutation.error.message
    : null
  const errorMessage = mutationError ?? listError ?? historyError
  const connectionStatus = pendingApprovalsQuery.isFetching ? 'refreshing' : 'current'

  async function handleDecision(
    approval: PendingApproval,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    try {
      await decisionMutation.mutateAsync({ approval, decision })
      setPanelMessage(decision === 'approve' ? 'Approval granted.' : 'Approval rejected.')
      if (previewApproval?.id === approval.id) {
        setPreviewApproval(null)
      }
    } catch {
      // Hook state renders the error banner.
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--hv-bg)] px-5 py-5">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-border bg-washi-white">
        <div className="border-b border-ink-border/70 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-title">Action Queue</p>
              <h1 className="mt-2 font-display text-display text-sumi-black">Approvals</h1>
              <p className="mt-1 text-sm text-sumi-diluted">
                Review external actions before they leave the workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('badge-sumi', pendingCount > 0 && 'badge-idle')}>
                {pendingCount} pending
              </span>
              <span className={cn('badge-sumi', connectionStatus === 'current' ? 'badge-active' : 'badge-stale')}>
                {connectionStatus === 'current' ? (
                  <>
                    <Wifi size={12} className="mr-1" />
                    Current
                  </>
                ) : (
                  <>
                    <WifiOff size={12} className="mr-1" />
                    Refreshing
                  </>
                )}
              </span>
            </div>
          </div>

          {panelMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent-moss/20 bg-accent-moss/10 px-3 py-2 text-sm text-accent-moss">
              <Check size={14} className="mt-0.5 shrink-0" />
              <span>{panelMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent-vermillion/20 bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {pendingApprovalsQuery.isLoading && pendingApprovals.length === 0 ? (
            <div className="flex justify-center py-16">
              <Loader2 size={20} className="animate-spin text-sumi-diluted" />
            </div>
          ) : pendingApprovals.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {pendingApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onPreview={() => setPreviewApproval(approval)}
                  onApprove={() => { void handleDecision(approval, 'approve') }}
                  onDeny={() => { void handleDecision(approval, 'reject') }}
                />
              ))}
            </div>
          )}

          <section className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-title">Recent Decisions</p>
                <p className="mt-1 text-xs text-sumi-diluted">
                  Latest queue activity from the audit log.
                </p>
              </div>
              {approvalHistoryQuery.isFetching && (
                <Loader2 size={14} className="animate-spin text-sumi-diluted" />
              )}
            </div>

            {approvalHistory.length === 0 ? (
              <div className="rounded-xl border border-ink-border/60 bg-washi-aged/40 px-4 py-4 text-sm text-sumi-diluted">
                No recent approval activity yet.
              </div>
            ) : (
              <div className="space-y-3">
                {approvalHistory.map((entry) => (
                  <ApprovalHistoryCard key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <ApprovalSheet approval={previewApproval} onClose={() => setPreviewApproval(null)} />
    </div>
  )
}
