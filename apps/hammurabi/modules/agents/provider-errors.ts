import type { ProviderErrorClassification } from '../../src/types/transcript-envelope.js'

const USAGE_LIMIT_PATTERNS = [
  /\busage[-_\s]?limit/iu,
  /\bquota\b/iu,
  /\brate[-_\s]?limit(?:ed)?\b/iu,
  /\btoo many requests\b/iu,
  /\b429\b/u,
  /\blimit exceeded\b/iu,
]

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
