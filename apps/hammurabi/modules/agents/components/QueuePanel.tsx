import { ArrowDown, ArrowUp, ListPlus, X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import type { SessionQueueSnapshot } from '@/types'
import { cn } from '@/lib/utils'
import {
  formatQueuePreview,
  getQueuePendingCount,
  getQueuedMessageLabel,
} from '../queue-state'

interface QueuePanelProps {
  open: boolean
  theme: 'light' | 'dark'
  queueSnapshot?: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating: boolean
  canQueueDraft?: boolean
  onQueueDraft?: () => void | Promise<void>
  onClearQueue?: () => void
  onMoveQueuedMessage?: (id: string, offset: number) => void
  onRemoveQueuedMessage?: (id: string) => void
  onClose: () => void
}

export function QueuePanel({
  open,
  theme,
  queueSnapshot,
  queueError,
  isQueueMutating,
  canQueueDraft = false,
  onQueueDraft,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  onClose,
}: QueuePanelProps) {
  if (!open) {
    return null
  }

  const currentQueuedMessage = queueSnapshot?.currentMessage ?? null
  const queueItems = queueSnapshot?.items ?? []
  const totalQueuedCount = getQueuePendingCount(queueSnapshot)
  const maxSize = typeof queueSnapshot?.maxSize === 'number' ? queueSnapshot.maxSize : 0
  const canClearQueue = (totalQueuedCount > 0 || currentQueuedMessage !== null) && !isQueueMutating && Boolean(onClearQueue)
  const canQueueCurrentDraft = canQueueDraft && Boolean(onQueueDraft)
  const themeRootClassName = theme === 'dark' ? 'hv-dark' : 'hv-light'

  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title="Queue"
      position="bottom-sheet"
      portalThemeClassName={themeRootClassName}
      backdropClassName={cn(
        'sheet-backdrop--hervald',
        theme === 'dark' && 'sheet-backdrop--hervald-dark',
      )}
      contentClassName={cn(
        'sheet visible sheet--hervald',
        theme === 'dark' && 'sheet--hervald-dark',
        themeRootClassName,
      )}
      contentProps={{
        'aria-labelledby': 'queue-panel-title',
        'data-testid': 'queue-panel',
      }}
    >
        <div className="sheet-handle">
          <div className="sheet-handle-bar" />
        </div>

        <div className="px-5 pb-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="queue-panel-title"
                className="font-display text-heading text-[color:var(--hv-fg)]"
              >
                Queue
              </h2>
              <p className="mt-1 text-xs text-[color:var(--hv-fg-subtle)]">
                {`Pending ${totalQueuedCount}${maxSize > 0 ? `/${maxSize}` : ''}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canQueueCurrentDraft && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-accent-success)] px-2.5 py-1.5 text-[11px] font-mono text-[color:var(--hv-accent-success)] transition-colors hover:bg-[var(--hv-accent-success-wash)]"
                  onClick={() => {
                    void onQueueDraft?.()
                    onClose()
                  }}
                  aria-label="Queue current draft"
                >
                  <ListPlus size={14} aria-hidden="true" />
                  Queue this draft
                </button>
              )}
              <button
                type="button"
                className="rounded-lg border border-[color:var(--hv-border-hair)] px-2.5 py-1.5 text-[11px] font-mono text-[color:var(--hv-fg-subtle)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onClearQueue}
                disabled={!canClearQueue}
              >
                Clear
              </button>
              <button
                type="button"
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[color:var(--hv-border-hair)] text-[color:var(--hv-fg-subtle)] transition-colors hover:bg-[var(--hv-surface-hover)] hover:text-[color:var(--hv-fg)]"
                onClick={onClose}
                aria-label="Close queue"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {currentQueuedMessage ? (
            <div className="rounded-lg border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="badge-sumi bg-[var(--hv-accent-success-wash)] text-[10px] text-[color:var(--hv-accent-success)]">
                  Working on
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-[color:var(--hv-accent-success)]">
                  {getQueuedMessageLabel(currentQueuedMessage)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--hv-fg)]">
                {formatQueuePreview(currentQueuedMessage, 160)}
              </p>
            </div>
          ) : null}

          {queueItems.length > 0 ? (
            <div className={cn('space-y-2', currentQueuedMessage ? 'mt-3' : '')}>
              {queueItems.map((message, index) => (
                <div
                  key={message.id}
                  className="rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[color:var(--hv-fg-faint)]">
                          #{index + 1}
                        </span>
                        <span className="badge-sumi bg-[var(--hv-bg-sunken)] text-[10px] text-[color:var(--hv-fg-subtle)]">
                          {getQueuedMessageLabel(message)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[color:var(--hv-fg)]">
                        {formatQueuePreview(message, 140)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1 text-[11px] text-[color:var(--hv-fg-subtle)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onMoveQueuedMessage?.(message.id, -1)}
                        disabled={index === 0 || isQueueMutating || !onMoveQueuedMessage}
                        aria-label={`Move queued message ${index + 1} up`}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1 text-[11px] text-[color:var(--hv-fg-subtle)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onMoveQueuedMessage?.(message.id, 1)}
                        disabled={index === queueItems.length - 1 || isQueueMutating || !onMoveQueuedMessage}
                        aria-label={`Move queued message ${index + 1} down`}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[color:var(--hv-accent-danger)] px-2 py-1 text-[11px] text-[color:var(--hv-accent-danger)] transition-colors hover:bg-[var(--hv-accent-danger-wash)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onRemoveQueuedMessage?.(message.id)}
                        disabled={isQueueMutating || !onRemoveQueuedMessage}
                        aria-label={`Remove queued message ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <p className={cn(
            'text-[11px] text-[color:var(--hv-fg-faint)]',
            currentQueuedMessage || queueItems.length > 0 ? 'mt-3' : '',
          )}>
            Press Tab to queue a follow-up without interrupting the current turn.
          </p>

          {queueError ? (
            <div className="mt-3 rounded-lg bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-[11px] text-[color:var(--hv-accent-danger)]">
              {queueError}
            </div>
          ) : null}
        </div>
    </DismissibleOverlay>
  )
}
