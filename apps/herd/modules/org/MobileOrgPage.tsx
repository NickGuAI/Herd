import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Zap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { CommanderRow } from '@modules/org/components/CommanderRow'
import type { OrgNode, OrgTree } from '@modules/org/types'
import BottomSheet from '@/components/BottomSheet'
import { AgentAvatar, Chip, StatusDot } from '@modules/components/hervald'
import { resolveFounderAvatarSrc } from '@modules/operators/founder-avatar'

function statusLabel(status: string, archived: boolean | undefined) {
  if (archived) {
    return 'Archived'
  }
  if (status === 'active' || status === 'running') {
    return 'Running'
  }
  if (!status || status === 'idle' || status === 'paused' || status === 'stopped') {
    return 'Idle'
  }
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function statusDotState(status: string, archived: boolean | undefined) {
  if (archived) {
    return 'idle'
  }
  if (status === 'active' || status === 'running') {
    return 'active'
  }
  return status || 'idle'
}

function initials(name?: string | null): string {
  const source = name?.trim() || 'Founder'
  const [first = 'F', second = 'O'] = source.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function MobileCommanderTile({
  commander,
  automationCount,
  selected,
  onSelect,
}: {
  commander: OrgNode
  automationCount: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <article
      data-testid="mobile-org-commander-tile"
      data-commander-card={commander.id}
      className={[
        'card-sumi rounded-lg transition-colors',
        selected ? 'bg-[var(--hv-surface-selected)] ring-1 ring-[color:var(--hv-border-firm)]' : '',
        commander.archived ? 'opacity-60' : '',
      ].join(' ').trim()}
    >
      <button
        type="button"
        data-testid="mobile-org-commander-toggle"
        onClick={onSelect}
        className="flex min-h-[58px] w-full appearance-none items-center justify-between gap-3 px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <AgentAvatar
            commander={{
              id: commander.id,
              displayName: commander.displayName,
              avatarUrl: commander.avatarUrl,
              ui: commander.profile,
            }}
            size={40}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[color:var(--hv-fg)]">{commander.displayName}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-[color:var(--hv-fg-subtle)]">
              <StatusDot state={statusDotState(commander.status, commander.archived)} size={6} />
              <span className="truncate">
                Commander · {statusLabel(commander.status, commander.archived)} · {automationCount} automation
                {automationCount === 1 ? '' : 's'}
              </span>
            </span>
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-[color:var(--hv-fg-subtle)]" aria-hidden="true" />
      </button>
    </article>
  )
}

function MobileCommanderDetailSheet({
  commander,
  automations,
  highlighted,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
  onClose,
}: {
  commander: OrgNode | null
  automations: ReadonlyArray<OrgNode>
  highlighted: boolean
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  onClose: () => void
}) {
  if (!commander) {
    return null
  }

  return (
    <BottomSheet open={Boolean(commander)} onClose={onClose} maxHeight="85dvh">
      <div className="overflow-y-auto px-4 pb-5 pt-2" data-testid="mobile-org-commander-sheet">
        <CommanderRow
          commander={commander}
          automations={automations}
          highlighted={highlighted}
          onEdit={(selectedCommander) => {
            onClose()
            onEdit(selectedCommander)
          }}
          onReplicate={(selectedCommander) => {
            onClose()
            onReplicate(selectedCommander)
          }}
          onDelete={(selectedCommander) => {
            onClose()
            onDelete(selectedCommander)
          }}
          onRestore={(selectedCommander) => {
            onClose()
            onRestore(selectedCommander)
          }}
          onSaveTemplate={onSaveTemplate}
        />
      </div>
    </BottomSheet>
  )
}

export function MobileOrgPage({
  tree,
  commanders,
  operatorAutomationCount,
  showArchived,
  highlightedCommanderId,
  restoringCommanderId,
  onToggleArchived,
  onHire,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
  getCommanderAutomations,
}: {
  tree: OrgTree
  commanders: OrgNode[]
  operatorAutomationCount: number
  showArchived: boolean
  highlightedCommanderId: string | null
  restoringCommanderId: string | null
  onToggleArchived: () => void
  onHire: () => void
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  getCommanderAutomations: (commanderId: string) => ReadonlyArray<OrgNode>
}) {
  const navigate = useNavigate()
  const auth = useAuth()
  const [selectedCommanderId, setSelectedCommanderId] = useState<string | null>(highlightedCommanderId)
  const founder = tree.operator
  const founderAvatarSrc = resolveFounderAvatarSrc(founder, auth)
  const selectedCommander = commanders.find((commander) => commander.id === selectedCommanderId) ?? null

  useEffect(() => {
    if (!highlightedCommanderId) {
      return
    }
    if (!commanders.some((commander) => commander.id === highlightedCommanderId)) {
      return
    }
    setSelectedCommanderId(highlightedCommanderId)
  }, [commanders, highlightedCommanderId])

  useEffect(() => {
    if (!selectedCommanderId) {
      return
    }
    if (commanders.some((commander) => commander.id === selectedCommanderId)) {
      return
    }
    setSelectedCommanderId(null)
  }, [commanders, selectedCommanderId])

  return (
    <>
      <div
        data-testid="mobile-org-page"
        className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-[var(--hv-bg)] px-3 pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] pt-3"
      >
        <header className="flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-medium leading-7 text-[color:var(--hv-fg)]">{tree.orgIdentity?.name || 'Organization'}</h1>
            <p className="mt-0.5 truncate text-[11px] text-[color:var(--hv-fg-subtle)]">Organization · {founder.displayName}</p>
          </div>
          <button
            type="button"
            data-testid="mobile-commander-hire-button"
            onClick={onHire}
            className="btn-primary inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3 py-0 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]"
          >
            Hire
          </button>
        </header>

        <article className="card-sumi rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {founderAvatarSrc ? (
                <AgentAvatar
                  commander={{
                    id: founder.id,
                    displayName: founder.displayName,
                    avatarUrl: founderAvatarSrc,
                  }}
                  size={40}
                />
              ) : (
                <div
                  data-testid="mobile-founder-avatar-initials"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-raised)] font-display text-base italic text-[color:var(--hv-fg-muted)]"
                  aria-label={`${founder.displayName} avatar`}
                >
                  {initials(founder.displayName)}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-medium text-[color:var(--hv-fg)]">{founder.displayName}</p>
                  <Chip>Founder</Chip>
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled
              title="Multi-operator coming soon"
              className="btn-ghost inline-flex h-8 items-center justify-center rounded-lg px-3 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              Invite
            </button>
          </div>
        </article>

        <button
          type="button"
          data-testid="mobile-global-automation-chip"
          onClick={() => navigate('/automations?commander=global')}
          className="card-sumi flex min-h-[58px] w-full appearance-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--hv-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]">
              <Zap size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[color:var(--hv-fg)]">
                Global Automation · {operatorAutomationCount} active
              </span>
              <span className="mt-0.5 block text-[11px] text-[color:var(--hv-fg-subtle)]">Automation page</span>
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-[color:var(--hv-fg-subtle)]" aria-hidden="true" />
        </button>

        {tree.archivedCommandersCount > 0 ? (
          <button
            type="button"
            data-testid="mobile-archived-commanders-toggle"
            onClick={onToggleArchived}
            className="btn-ghost inline-flex h-8 items-center justify-center gap-2 self-start rounded-lg px-3 py-0 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]"
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            {showArchived ? 'Hide archived' : `View archived (${tree.archivedCommandersCount})`}
          </button>
        ) : null}

        {commanders.length === 0 ? (
          <div className="card-sumi rounded-lg px-4 py-8 text-center">
            <div className="space-y-2">
              <p className="text-sm text-[color:var(--hv-fg)]">Hire your first commander.</p>
              <p className="text-xs leading-5 text-[color:var(--hv-fg-subtle)]">
                Chat with the setup wizard to define the AI worker you need and create it after preview.
              </p>
            </div>
            <button
              type="button"
              data-testid="mobile-empty-org-hire-button"
              onClick={onHire}
              className="btn-primary mt-4 inline-flex h-9 items-center justify-center rounded-lg px-4 py-0 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]"
            >
              Start setup chat
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {commanders.map((commander) => (
              <MobileCommanderTile
                key={commander.id}
                commander={commander}
                automationCount={getCommanderAutomations(commander.id).length}
                selected={commander.id === selectedCommanderId}
                onSelect={() => setSelectedCommanderId(commander.id)}
              />
            ))}
          </div>
        )}
      </div>

      <MobileCommanderDetailSheet
        commander={selectedCommander}
        automations={selectedCommander ? getCommanderAutomations(selectedCommander.id) : []}
        highlighted={selectedCommander?.id === highlightedCommanderId}
        onEdit={onEdit}
        onReplicate={onReplicate}
        onDelete={onDelete}
        onRestore={(commander) => {
          if (restoringCommanderId === null) {
            onRestore(commander)
          }
        }}
        onSaveTemplate={onSaveTemplate}
        onClose={() => setSelectedCommanderId(null)}
      />
    </>
  )
}
