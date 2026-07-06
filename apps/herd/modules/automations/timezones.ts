export function detectBrowserTimezone(): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
  return resolved && resolved.trim().length > 0 ? resolved : 'UTC'
}

function listIanaTimezones(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf
  if (typeof supportedValuesOf !== 'function') {
    return []
  }

  try {
    return supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

export const TIMEZONE_OPTIONS = listIanaTimezones()
