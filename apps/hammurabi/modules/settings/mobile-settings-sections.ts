import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  CircleUserRound,
  Eye,
  Info,
  Monitor,
  RadioTower,
} from 'lucide-react'

export type MobileSettingsSectionId =
  | 'account'
  | 'telemetry'
  | 'notifications'
  | 'machines'
  | 'appearance'
  | 'about'

export interface MobileSettingsSection {
  id: MobileSettingsSectionId
  label: string
  icon: LucideIcon
  fullPagePath?: string
}

export const MOBILE_SETTINGS_BASE_PATH = '/command-room/settings'

export const MOBILE_SETTINGS_SECTIONS: readonly MobileSettingsSection[] = [
  {
    id: 'account',
    label: 'Account',
    icon: CircleUserRound,
    fullPagePath: '/api-keys',
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: RadioTower,
    fullPagePath: '/telemetry',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    fullPagePath: '/policies',
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: Monitor,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Eye,
  },
  {
    id: 'about',
    label: 'About',
    icon: Info,
  },
] as const

const MOBILE_SETTINGS_SECTION_IDS = new Set(
  MOBILE_SETTINGS_SECTIONS.map((section) => section.id),
)

export function isMobileSettingsSectionId(
  value: string | undefined,
): value is MobileSettingsSectionId {
  return Boolean(value && MOBILE_SETTINGS_SECTION_IDS.has(value as MobileSettingsSectionId))
}

export function getMobileSettingsSection(
  value: string | undefined,
): MobileSettingsSection | null {
  if (!isMobileSettingsSectionId(value)) {
    return null
  }
  return MOBILE_SETTINGS_SECTIONS.find((section) => section.id === value) ?? null
}

export function getMobileSettingsPath(
  sectionId: MobileSettingsSectionId,
): string {
  return `${MOBILE_SETTINGS_BASE_PATH}/${sectionId}`
}
