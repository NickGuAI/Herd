import { ChromaGrid, type ChromaItem } from '@/components/ChromaGrid'
import { readHvToken } from '@/lib/hv-tokens'
import { useTheme } from '@/lib/theme-context'
import { ensureCommanderVisualProfile } from '@modules/commanders/commander-visual-profile'
import type { OrgNode } from '../types'

const SUMI_E_THEME_FALLBACKS = {
  light: {
    avatarFill: '#F0EBE3',
    textFill: '#1C1C1C',
  },
  dark: {
    avatarFill: '#33302D',
    textFill: '#FAF8F5',
  },
} as const

function slugifyDisplayName(displayName: string): string {
  return (
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'commander'
  )
}

function initials(displayName: string): string {
  const [first = 'C', second = 'M'] = displayName.trim().split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function statusLabel(status: string) {
  if (status === 'active' || status === 'running') {
    return 'Running'
  }

  if (!status || status === 'idle' || status === 'paused' || status === 'stopped') {
    return 'Idle'
  }

  return status.charAt(0).toUpperCase() + status.slice(1)
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function resolveSvgPaint(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  const tokenMatch = /^var\((--[a-z0-9-]+)\)$/i.exec(trimmed)
  if (!tokenMatch) {
    return trimmed
  }
  return readHvToken(tokenMatch[1]) || trimmed
}

function buildCommanderInitialsAvatarDataUrl({
  displayName,
  theme,
  borderColor,
}: {
  displayName: string
  theme: 'light' | 'dark'
  borderColor?: string | null
}) {
  // The SVG data URL needs literal fallback values if CSS variables have not
  // resolved yet. These are the Sumi-e scheme values from
  // docs/design-systems/sumi-e/COLOR_SCHEMES.md.
  const fallback = SUMI_E_THEME_FALLBACKS[theme]
  const avatarFill = readHvToken('--hv-bg-elevated') || fallback.avatarFill
  const textFill = readHvToken('--hv-fg') || fallback.textFill
  const stroke = resolveSvgPaint(borderColor) || readHvToken('--hv-border-soft') || 'currentColor'
  const bodyFont = readHvToken('--hv-font-body') || 'sans-serif'
  const safeInitials = escapeSvgText(initials(displayName))
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" aria-hidden="true">',
    `<rect x="0.5" y="0.5" width="55" height="55" rx="18" fill="${avatarFill}" stroke="${stroke}" />`,
    '<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"',
    ` fill="${textFill}" font-family="${bodyFont}"`,
    ' font-size="18" font-weight="700" letter-spacing="1.25">',
    safeInitials,
    '</text>',
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export function buildCommanderChromaItems({
  commanders,
  expandedId,
  onSelect,
  theme,
}: {
  commanders: OrgNode[]
  expandedId: string | null
  onSelect: (id: string | null) => void
  theme: 'light' | 'dark'
}): ChromaItem[] {
  return commanders.map((commander) => {
    const isSelected = commander.id === expandedId
    const handle = `@${slugifyDisplayName(commander.displayName)}`
    const profile = ensureCommanderVisualProfile(commander.id, commander.profile ?? null)
    const borderColor = profile.borderColor
    const accentColor = profile.accentColor

    return {
      id: commander.id,
      image: commander.avatarUrl ?? buildCommanderInitialsAvatarDataUrl({
        displayName: commander.displayName,
        theme,
        borderColor,
      }),
      title: commander.displayName,
      subtitle: profile.speakingTone ?? 'Commander',
      handle,
      location: commander.archived ? 'Archived' : statusLabel(commander.status),
      borderColor,
      gradient: accentColor ? `linear-gradient(165deg,${accentColor},var(--hv-bg-sunken))` : undefined,
      cardClassName: [
        isSelected ? 'ring-2 ring-ink-border-firm' : '',
        commander.archived ? 'opacity-60' : '',
      ].join(' ').trim(),
      cardProps: {
        'aria-pressed': isSelected,
        'data-testid': 'commander-tile',
        'data-commander-card': commander.id,
      },
      onClick: () => onSelect(isSelected ? null : commander.id),
    }
  })
}

export function CommanderTileGrid({
  commanders,
  expandedId,
  onSelect,
}: {
  commanders: OrgNode[]
  expandedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { theme } = useTheme()
  const items = buildCommanderChromaItems({
    commanders,
    expandedId,
    onSelect,
    theme,
  })

  return (
    <ChromaGrid
      items={items}
      className="justify-start"
    />
  )
}
