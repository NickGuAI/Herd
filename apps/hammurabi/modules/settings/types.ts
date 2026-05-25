import type { ComposerAbilitySettings } from './composer-abilities.js'

export type AppTheme = 'light' | 'dark'

export interface AppSettings {
  theme: AppTheme
  fontScale: number
  composerAbilities: ComposerAbilitySettings
  updatedAt: string
}
