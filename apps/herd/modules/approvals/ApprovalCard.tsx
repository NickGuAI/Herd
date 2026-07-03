import { useState } from 'react'
import { Check, Eye, Loader2, X } from 'lucide-react'
import type { PendingApproval } from '@/hooks/use-approvals'
import { cn, timeAgo } from '@/lib/utils'

const PLACEMENT_CONTEXT_DETAIL_LABELS = new Set([
  'commander',
  'commander id',
  'commander name',
  'conversation',
  'conversation id',
  'conversation name',
  'session',
  'session id',
  'session name',
])

export interface ApprovalCardProps {
  approval: PendingApproval
  onApprove: () => void | Promise<void>
  onDeny: () => void | Promise<void>
  onPreview?: () => void
  compact?: boolean
  variant?: 'default' | 'inline'
  hideInlineContext?: boolean
  className?: string
}

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

function isCommandDetail(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return normalized === 'command' || normalized === 'command content' || normalized === 'raw command'
}

function isPlacementContextDetail(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return PLACEMENT_CONTEXT_DETAIL_LABELS.has(normalized)
}

function summaryMatchesCommandPreview(summary: string, commandPreview: string): boolean {
  const normalizedSummary = summary.trim()
  const normalizedCommand = commandPreview.trim()
  if (!normalizedSummary || !normalizedCommand) {
    return false
  }
  if (normalizedSummary === normalizedCommand) {
    return true
  }
  if (!normalizedSummary.endsWith('...')) {
    return false
  }
  const summaryPrefix = normalizedSummary.slice(0, -3).trimEnd()
  return summaryPrefix.length > 0 && normalizedCommand.startsWith(summaryPrefix)
}

export default function ApprovalCard({
  approval,
  onApprove,
  onDeny,
  onPreview,
  compact = false,
  variant = 'default',
  hideInlineContext = false,
  className,
}: ApprovalCardProps) {
  const [busyDecision, setBusyDecision] = useState<'approve' | 'reject' | null>(null)
  const busy = busyDecision !== null
  const inline = variant === 'inline'
  const showInlineContext = !(inline && hideInlineContext)
  const commandContent = approval.commandText
  const semanticPreview = commandContent ? approval.previewText : null
  const collapsiblePreview = commandContent ? null : approval.previewText
  const collapsibleContent = commandContent ?? collapsiblePreview
  const displaySummary = (
    inline && approval.summary && collapsibleContent &&
    summaryMatchesCommandPreview(approval.summary, collapsibleContent)
  )
    ? null
    : approval.summary
  const visibleDetails = inline
    ? approval.details.filter((detail) => (
      !isCommandDetail(detail.label)
      && (showInlineContext || !isPlacementContextDetail(detail.label))
    ))
    : approval.details

  async function handleDecision(
    decision: 'approve' | 'reject',
    action: () => void | Promise<void>,
  ) {
    if (busyDecision) {
      return
    }

    setBusyDecision(decision)
    try {
      await Promise.resolve(action())
    } finally {
      setBusyDecision(null)
    }
  }

  return (
    <article
      data-testid={inline ? 'inline-approval-card' : undefined}
      className={cn(
        inline
          ? 'rounded-lg border border-accent-vermillion/30 bg-accent-vermillion/5 px-3 py-3 shadow-sm'
          : 'card-sumi',
        compact || inline ? 'px-3 py-3' : 'px-4 py-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn('font-display text-sumi-black', inline ? 'text-sm' : 'text-heading')}>
              {inline ? `Approval required: ${approval.actionLabel}` : approval.actionLabel}
            </h3>
            <span className="badge-sumi">{formatSourceLabel(approval.source)}</span>
            {showInlineContext && approval.sessionName && (
              <span className="badge-sumi bg-washi-aged/80 text-sumi-diluted">
                {approval.sessionName}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-sumi-diluted">
            {showInlineContext && (
              <>
                {approval.commanderName ?? approval.sessionName ?? 'Unknown agent'}
                {' · '}
              </>
            )}
            {timeAgo(approval.requestedAt)}
          </p>
        </div>
        {(approval.reason || approval.risk) && (
          <div className="rounded-xl border border-accent-vermillion/20 bg-accent-vermillion/5 px-3 py-2 text-xs text-accent-vermillion">
            {approval.reason && <p>Reason: {approval.reason}</p>}
            {approval.risk && <p className={approval.reason ? 'mt-1' : ''}>Risk: {approval.risk}</p>}
          </div>
        )}
      </div>

      {visibleDetails.length > 0 && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {visibleDetails.slice(0, compact ? 2 : 4).map((detail) => (
            <div
              key={`${detail.label}:${detail.value}`}
              className="rounded-xl border border-ink-border/60 bg-washi-aged/45 px-3 py-3"
            >
              <dt className="text-[11px] uppercase tracking-[0.18em] text-sumi-mist">
                {detail.label}
              </dt>
              <dd className="mt-2 break-words text-sm text-sumi-black">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(displaySummary || semanticPreview || collapsibleContent) && (
        <div className="mt-4 rounded-xl border border-ink-border/60 bg-ink-wash px-4 py-3">
          {displaySummary && (
            <p className="text-sm leading-relaxed text-sumi-gray">{displaySummary}</p>
          )}
          {semanticPreview && (
            <p
              className={cn('text-sm leading-relaxed text-sumi-gray', displaySummary && 'mt-2')}
              data-testid={inline ? 'inline-approval-preview-text' : undefined}
            >
              {semanticPreview}
            </p>
          )}
          {collapsibleContent && (
            <details
              className={cn(
                'group text-sm text-sumi-gray',
                (displaySummary || semanticPreview) && 'mt-2',
              )}
            >
              <summary
                className="cursor-pointer text-xs font-medium uppercase tracking-[0.16em] text-sumi-diluted"
                data-testid={inline ? 'inline-approval-command-summary' : undefined}
              >
                {commandContent ? 'Command content' : 'Full preview'}
              </summary>
              <pre
                className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-ink-border/60 bg-washi-aged/50 px-3 py-2 text-xs leading-relaxed"
                data-testid={inline ? 'inline-approval-command-content' : undefined}
              >
                {collapsibleContent}
              </pre>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            className="btn-ghost inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            <Eye size={14} />
            Preview
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleDecision('reject', onDeny)}
          disabled={busy}
          className="btn-ghost inline-flex items-center gap-2 px-4 py-2.5 text-sm text-accent-vermillion disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          Reject
        </button>
        <button
          type="button"
          onClick={() => void handleDecision('approve', onApprove)}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
      </div>
    </article>
  )
}
