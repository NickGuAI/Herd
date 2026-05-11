export interface CommanderVisualProfileFields {
  borderColor?: string | null
  accentColor?: string | null
  speakingTone?: string | null
  avatar?: string | null
}

export interface CommanderVisualColors {
  borderColor: string
  accentColor: string
}

export const COMMANDER_VISUAL_PROFILE_PALETTE = [
  'var(--hv-accent-danger)',
  'var(--hv-accent-warning)',
  'var(--hv-accent-success)',
  'var(--hv-accent-info)',
  'var(--hv-accent-plum)',
  'var(--hv-accent-bronze)',
  'var(--hv-accent-pine)',
  'var(--hv-accent-red)',
] as const

export function commanderVisualPaletteIndex(seed: string | null | undefined): number {
  const stableSeed = seed?.trim() || 'commander'
  let hash = 0
  for (let index = 0; index < stableSeed.length; index += 1) {
    hash = (hash * 31 + stableSeed.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % COMMANDER_VISUAL_PROFILE_PALETTE.length
}

export function defaultCommanderVisualProfile(
  commanderId: string | null | undefined,
): CommanderVisualColors {
  const color = COMMANDER_VISUAL_PROFILE_PALETTE[commanderVisualPaletteIndex(commanderId)]
  return {
    borderColor: color,
    accentColor: color,
  }
}

export function deterministicCommanderAccentColor(
  commanderId: string | null | undefined,
): string {
  return defaultCommanderVisualProfile(commanderId).accentColor
}

export function ensureCommanderVisualProfile<T extends CommanderVisualProfileFields>(
  commanderId: string | null | undefined,
  profile: T | null | undefined,
): T & CommanderVisualColors {
  const defaults = defaultCommanderVisualProfile(commanderId)
  const current = (profile ?? {}) as T
  const borderColor = current.borderColor?.trim() || defaults.borderColor
  const accentColor = current.accentColor?.trim() || defaults.accentColor

  return {
    ...current,
    borderColor,
    accentColor,
  }
}
