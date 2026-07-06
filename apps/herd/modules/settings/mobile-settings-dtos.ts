export const MOBILE_SETTINGS_BASE_PATH = '/command-room/settings'

export const MOBILE_SETTINGS_SURFACES = ['mobile'] as const

export type MobileSettingsSurface = (typeof MOBILE_SETTINGS_SURFACES)[number]

export type MobileSettingsSectionId =
  | 'account'
  | 'telemetry'
  | 'notifications'
  | 'permissions'
  | 'machines'
  | 'credential-pools'
  | 'appearance'
  | 'about'

export type MobileSettingsSectionIcon =
  | 'circle-user-round'
  | 'radio-tower'
  | 'bell'
  | 'shield-check'
  | 'monitor'
  | 'key-round'
  | 'eye'
  | 'info'

/**
 * Claude-style grouped IA: every section belongs to one labeled group on the
 * settings index. Group order (account, workspace, app) and section order
 * within a group both follow `MOBILE_SETTINGS_SECTION_DEFINITIONS` order.
 */
export type MobileSettingsSectionGroup = 'account' | 'workspace' | 'app'

export interface MobileSettingsSectionDto {
  id: MobileSettingsSectionId
  label: string
  icon: MobileSettingsSectionIcon
  group: MobileSettingsSectionGroup
  path: string
  fullPagePath?: string
  visible: boolean
  surfaces: readonly MobileSettingsSurface[]
}

const MOBILE_SETTINGS_SECTION_DEFINITIONS: readonly (
  Omit<MobileSettingsSectionDto, 'path' | 'visible' | 'surfaces'>
  & { path?: string }
)[] = [
  {
    id: 'account',
    label: 'Account',
    icon: 'circle-user-round',
    group: 'account',
    fullPagePath: '/settings',
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: 'radio-tower',
    group: 'account',
    fullPagePath: '/telemetry',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'bell',
    group: 'account',
    fullPagePath: '/policies',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    icon: 'shield-check',
    group: 'account',
    path: '/policies',
    fullPagePath: '/policies',
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: 'monitor',
    group: 'workspace',
  },
  {
    id: 'credential-pools',
    label: 'Credential pools',
    icon: 'key-round',
    group: 'workspace',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'eye',
    group: 'app',
  },
  {
    id: 'about',
    label: 'About',
    icon: 'info',
    group: 'app',
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
    path: section.path ?? getMobileSettingsPath(section.id),
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
