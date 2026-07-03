export interface CommanderVisualProfileFields {
  speakingTone?: string | null
  avatar?: string | null
  portraitStyleId?: string | null
}

type LegacyCommanderColorFields = {
  borderColor?: unknown
  accentColor?: unknown
}

type CommanderVisualProfileWithoutColors<T> = Omit<T, keyof LegacyCommanderColorFields>

export function ensureCommanderVisualProfile<T extends CommanderVisualProfileFields & LegacyCommanderColorFields>(
  profile: T | null | undefined,
): CommanderVisualProfileWithoutColors<T> {
  const current = (profile ?? {}) as T
  const {
    borderColor: _borderColor,
    accentColor: _accentColor,
    ...rest
  } = current

  return rest as CommanderVisualProfileWithoutColors<T>
}
