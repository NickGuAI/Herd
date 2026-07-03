import type { ProviderErrorClassification } from '../../src/types/transcript-envelope.js'

const USAGE_LIMIT_PATTERNS = [
  /\busage[-_\s]?limit/iu,
  /\bsession[-_\s]?limit\b/iu,
  /\bquota\b/iu,
  /\brate[-_\s]?limit(?:ed)?\b/iu,
  /\btoo many requests\b/iu,
  /\b429\b/u,
  /\blimit exceeded\b/iu,
]

export interface ProviderLimitDetails {
  classification: ProviderErrorClassification
  resetAt?: string
}

const AUTH_REQUIRED_PATTERNS = [
  /\bauth(?:entication|orization)?\b/iu,
  /\blogin\b/iu,
  /\bunauthori[sz]ed\b/iu,
  /\b401\b/u,
  /\btoken expired\b/iu,
  /\binvalid api key\b/iu,
  /\bapi key\b/iu,
]

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

export function classifyProviderError(
  message?: string,
  code?: string,
): ProviderErrorClassification {
  const haystack = [code, message].filter(Boolean).join(' ')
  if (matchesAny(haystack, USAGE_LIMIT_PATTERNS)) {
    return 'usage_limit'
  }
  if (matchesAny(haystack, AUTH_REQUIRED_PATTERNS)) {
    return 'auth_required'
  }
  return 'other'
}

function normalizeReferenceTime(value: Date | string | number | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return new Date()
}

function normalizeResetAtIso(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    const parsed = new Date(millis)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function parseClockResetAt(text: string, referenceTime: Date): string | undefined {
  const match = text.match(/\breset(?:s|ting)?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(?\s*(utc|z)\s*\)?)?/iu)
  if (!match) {
    return undefined
  }

  let hour = Number.parseInt(match[1] ?? '', 10)
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return undefined
  }

  const meridiem = match[3]?.toLowerCase()
  if (meridiem === 'pm' && hour < 12) {
    hour += 12
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0
  }

  const resetAt = new Date(Date.UTC(
    referenceTime.getUTCFullYear(),
    referenceTime.getUTCMonth(),
    referenceTime.getUTCDate(),
    hour,
    minute,
    0,
    0,
  ))
  if (resetAt.getTime() <= referenceTime.getTime()) {
    resetAt.setUTCDate(resetAt.getUTCDate() + 1)
  }
  return resetAt.toISOString()
}

function parseResetAtFromText(text: string, referenceTime: Date): string | undefined {
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/u)
  const isoReset = isoMatch ? normalizeResetAtIso(isoMatch[0]) : undefined
  return isoReset ?? parseClockResetAt(text, referenceTime)
}

export function extractProviderLimitDetails(
  message?: string,
  code?: string,
  options: {
    referenceTime?: Date | string | number
    resetAt?: string | number
  } = {},
): ProviderLimitDetails {
  const classification = classifyProviderError(message, code)
  if (classification !== 'usage_limit') {
    return { classification }
  }

  const explicitResetAt = normalizeResetAtIso(options.resetAt)
  if (explicitResetAt) {
    return { classification, resetAt: explicitResetAt }
  }

  const haystack = [code, message].filter(Boolean).join(' ')
  const parsedResetAt = haystack
    ? parseResetAtFromText(haystack, normalizeReferenceTime(options.referenceTime))
    : undefined
  return {
    classification,
    ...(parsedResetAt ? { resetAt: parsedResetAt } : {}),
  }
}
