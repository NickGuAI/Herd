export interface ParsedEmailAddress {
  address: string
  localPart: string
  domain: string
  plusAlias?: string
}

const ADDRESS_PATTERN = /<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i

export function extractEmailAddress(value: string | undefined | null): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return null
  }
  const match = raw.match(ADDRESS_PATTERN)
  return match?.[1]?.toLowerCase() ?? null
}

export function parseEmailAddress(value: string): ParsedEmailAddress | null {
  const address = extractEmailAddress(value)
  if (!address) {
    return null
  }
  const atIndex = address.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === address.length - 1) {
    return null
  }
  const localPart = address.slice(0, atIndex)
  const domain = address.slice(atIndex + 1)
  const plusIndex = localPart.indexOf('+')
  const plusAlias = plusIndex >= 0
    ? localPart.slice(plusIndex + 1).trim().toLowerCase()
    : undefined
  return {
    address,
    localPart,
    domain,
    ...(plusAlias ? { plusAlias } : {}),
  }
}

export function parsePlusAliasFromRecipients(recipients: readonly string[]): string | null {
  for (const recipient of recipients) {
    const parsed = parseEmailAddress(recipient)
    if (parsed?.plusAlias) {
      return parsed.plusAlias
    }
  }
  return null
}

export function normalizeEmailAlias(value: string | undefined): string | null {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase()
    : ''
  if (!normalized) {
    return null
  }
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(normalized) ? normalized : null
}
