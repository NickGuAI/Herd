export const MOBILE_SETTINGS_BASE_PATH = '/command-room/settings'

export const MOBILE_SETTINGS_SURFACES = ['mobile'] as const

export type MobileSettingsSurface = (typeof MOBILE_SETTINGS_SURFACES)[number]

export type MobileSettingsSectionId =
  | 'account'
  | 'telemetry'
  | 'notifications'
  | 'machines'
  | 'credential-pools'
  | 'appearance'
  | 'about'

export type MobileSettingsSectionIcon =
  | 'circle-user-round'
  | 'radio-tower'
  | 'bell'
  | 'monitor'
  | 'key-round'
  | 'eye'
  | 'info'

export interface MobileSettingsSectionDto {
  id: MobileSettingsSectionId
  label: string
  icon: MobileSettingsSectionIcon
  path: string
  fullPagePath?: string
  visible: boolean
  surfaces: readonly MobileSettingsSurface[]
}

const MOBILE_SETTINGS_SECTION_DEFINITIONS: readonly Omit<MobileSettingsSectionDto, 'path' | 'visible' | 'surfaces'>[] = [
  {
    id: 'account',
    label: 'Account',
    icon: 'circle-user-round',
    fullPagePath: '/api-keys',
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: 'radio-tower',
    fullPagePath: '/telemetry',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'bell',
    fullPagePath: '/policies',
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: 'monitor',
  },
  {
    id: 'credential-pools',
    label: 'Credential pools',
    icon: 'key-round',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'eye',
  },
  {
    id: 'about',
    label: 'About',
    icon: 'info',
  },
] as const

export const MOBILE_SETTINGS_SECTION_IDS = new Set<MobileSettingsSectionId>(
  MOBILE_SETTINGS_SECTION_DEFINITIONS.map((section) => section.id),
)

export function isMobileSettingsSectionId(
  value: string | undefined,
): value is MobileSettingsSectionId {
  return Boolean(value && MOBILE_SETTINGS_SECTION_IDS.has(value as MobileSettingsSectionId))
}

export function getMobileSettingsPath(
  sectionId: MobileSettingsSectionId,
): string {
  return `${MOBILE_SETTINGS_BASE_PATH}/${sectionId}`
}

export function listMobileSettingsSections(): readonly MobileSettingsSectionDto[] {
  return MOBILE_SETTINGS_SECTION_DEFINITIONS.map((section) => ({
    ...section,
    path: getMobileSettingsPath(section.id),
    visible: true,
    surfaces: MOBILE_SETTINGS_SURFACES,
  }))
}

export function getMobileSettingsSection(
  value: string | undefined,
): MobileSettingsSectionDto | null {
  if (!isMobileSettingsSectionId(value)) {
    return null
  }
  return listMobileSettingsSections().find((section) => section.id === value) ?? null
}

export function buildMobileSettingsDto(): { sections: readonly MobileSettingsSectionDto[] } {
  return {
    sections: listMobileSettingsSections(),
  }
}
