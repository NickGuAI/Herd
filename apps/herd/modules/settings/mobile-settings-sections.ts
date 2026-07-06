import type { LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  CircleUserRound,
  Eye,
  Info,
  KeyRound,
  Monitor,
  RadioTower,
  ShieldCheck,
} from 'lucide-react'
import {
  MOBILE_SETTINGS_BASE_PATH,
  getMobileSettingsPath,
  getMobileSettingsSection,
  isMobileSettingsSectionId,
  listMobileSettingsSections,
  type MobileSettingsSectionDto,
  type MobileSettingsSectionGroup,
  type MobileSettingsSectionIcon,
  type MobileSettingsSectionId,
} from './mobile-settings-dtos'
import { fetchJson } from '@/lib/api'

export interface MobileSettingsSection {
  id: MobileSettingsSectionId
  label: string
  icon: LucideIcon
  group: MobileSettingsSectionGroup
  path: string
  fullPagePath?: string
  visible: boolean
  surfaces: MobileSettingsSectionDto['surfaces']
}

const MOBILE_SETTINGS_ICON_COMPONENTS = {
  'circle-user-round': CircleUserRound,
  'radio-tower': RadioTower,
  bell: Bell,
  'shield-check': ShieldCheck,
  monitor: Monitor,
  'key-round': KeyRound,
  eye: Eye,
  info: Info,
} satisfies Record<MobileSettingsSectionIcon, LucideIcon>

function toMobileSettingsSection(section: MobileSettingsSectionDto): MobileSettingsSection {
  return {
    ...section,
    icon: MOBILE_SETTINGS_ICON_COMPONENTS[section.icon],
  }
}

export const MOBILE_SETTINGS_SECTIONS: readonly MobileSettingsSection[] =
  listMobileSettingsSections().map(toMobileSettingsSection)

export function getMobileSettingsUiSection(
  value: string | undefined,
): MobileSettingsSection | null {
  const section = getMobileSettingsSection(value)
  return section ? toMobileSettingsSection(section) : null
}

export function findMobileSettingsUiSection(
  sections: readonly MobileSettingsSection[],
  value: string | undefined,
): MobileSettingsSection | null {
  return sections.find((section) => section.id === value) ?? null
}

export function useMobileSettingsSections() {
  return useQuery({
    queryKey: ['settings', 'mobile'],
    queryFn: () => fetchJson<{ sections: readonly MobileSettingsSectionDto[] }>('/api/settings/mobile'),
    initialData: { sections: listMobileSettingsSections() },
    select: (data) => data.sections
      .filter((section) => section.visible)
      .map(toMobileSettingsSection),
    staleTime: 60_000,
  })
}

export {
  MOBILE_SETTINGS_BASE_PATH,
  getMobileSettingsPath,
  isMobileSettingsSectionId,
  type MobileSettingsSectionDto,
  type MobileSettingsSectionGroup,
  type MobileSettingsSectionIcon,
  type MobileSettingsSectionId,
}
