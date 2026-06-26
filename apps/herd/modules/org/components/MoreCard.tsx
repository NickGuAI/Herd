import { useState } from 'react'
import { Copy, Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { OrgNode } from '../types'

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]'

export function MoreCard({
  commander,
  onEdit,
  onReplicate,
  onSaveTemplate,
  onDelete,
}: {
  commander: OrgNode
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
}) {
  const [open, setOpen] = useState(false)

  function handleAction(action: (commander: OrgNode) => void) {
    setOpen(false)
    action(commander)
  }

  return (
    <article data-testid="commander-more-card" className="card-sumi relative flex h-full min-h-40 flex-col gap-4 p-5">
      <div>
        <p className="section-title">More</p>
        <p className="mt-1 text-sm text-[color:var(--hv-fg-subtle)]">Manage commander</p>
      </div>
      <button
        type="button"
        data-testid="commander-actions-menu"
        onClick={() => setOpen((current) => !current)}
        className="mt-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--hv-border-hair)] text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
        aria-expanded={open}
        aria-label={`More actions for ${commander.displayName}`}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute bottom-4 right-4 z-10 flex min-w-48 flex-col rounded-2xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] p-2 shadow-lg">
          <button type="button" onClick={() => handleAction(onEdit)} className={MENU_ITEM_CLASS}>
            <Pencil size={14} aria-hidden="true" />
            Edit
          </button>
          <button type="button" onClick={() => handleAction(onReplicate)} className={MENU_ITEM_CLASS}>
            <Copy size={14} aria-hidden="true" />
            Replicate
          </button>
          <button type="button" onClick={() => handleAction(onSaveTemplate)} className={MENU_ITEM_CLASS}>
            <Download size={14} aria-hidden="true" />
            Save as Template
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDelete)}
            className={`${MENU_ITEM_CLASS} text-[color:var(--hv-accent-danger)]`}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </article>
  )
}
