import { ProfileCard } from '@/components/ProfileCard'
import { cn } from '@/lib/utils'
import { StatusDot } from '@modules/components/hervald'
import type { OrgNode } from '../types'

export interface CommanderProfileCardItem {
  id: string
  avatarUrl?: string | null
  name: string
  title: string
  handle: string
  status: string
  statusState: string
  selected: boolean
  archived: boolean
  onClick: () => void
}

function slugifyDisplayName(displayName: string): string {
  return (
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'commander'
  )
}

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

export function buildCommanderProfileCardItems({
  commanders,
  expandedId,
  onSelect,
}: {
  commanders: OrgNode[]
  expandedId: string | null
  onSelect: (id: string | null) => void
}): CommanderProfileCardItem[] {
  return commanders.map((commander) => {
    const selected = commander.id === expandedId

    return {
      id: commander.id,
      avatarUrl: commander.avatarUrl,
      name: commander.displayName,
      title: 'Commander',
      handle: `@${slugifyDisplayName(commander.displayName)}`,
      status: statusLabel(commander.status, commander.archived),
      statusState: statusDotState(commander.status, commander.archived),
      selected,
      archived: commander.archived === true,
      onClick: () => onSelect(selected ? null : commander.id),
    }
  })
}

export function CommanderProfileCardGrid({
  commanders,
  expandedId,
  onSelect,
}: {
  commanders: OrgNode[]
  expandedId: string | null
  onSelect: (id: string | null) => void
}) {
  const items = buildCommanderProfileCardItems({
    commanders,
    expandedId,
    onSelect,
  })

  return (
    <div
      data-testid="commander-profile-card-grid"
      className="grid gap-4"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
      }}
    >
      {items.map((item) => (
        <ProfileCard
          key={item.id}
          avatarUrl={item.avatarUrl}
          miniAvatarUrl={item.avatarUrl}
          name={item.name}
          title={item.title}
          handle={item.handle}
          status={item.status}
          statusAdornment={<StatusDot state={item.statusState} pulse={item.statusState === 'active'} />}
          aria-pressed={item.selected}
          aria-label={`Open ${item.name}`}
          data-testid="commander-tile"
          data-commander-card={item.id}
          className={cn(
            item.selected ? 'is-selected' : '',
            item.archived ? 'is-archived' : '',
          )}
          onClick={item.onClick}
        />
      ))}
    </div>
  )
}
