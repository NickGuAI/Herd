import { extractEmailAddress } from './plus-address.js'

const NOREPLY_PATTERNS = [
  /no[-_.]?reply@/i,
  /do[-_.]?not[-_.]?reply@/i,
  /donotreply@/i,
  /mailer-daemon@/i,
  /postmaster@/i,
  /bounce/i,
  /notification/i,
]

export interface EmailFilterInput {
  from: string
  selfAddresses: readonly string[]
  autoSubmitted?: string
}

export type EmailFilterDecision =
  | { allowed: true }
  | { allowed: false; reason: 'self-message' | 'noreply-sender' | 'auto-submitted' | 'missing-sender' }

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export function checkEmailInboundFilter(input: EmailFilterInput): EmailFilterDecision {
  const sender = extractEmailAddress(input.from)
  if (!sender) {
    return { allowed: false, reason: 'missing-sender' }
  }

  const selfAddresses = new Set(
    input.selfAddresses
      .map((entry) => extractEmailAddress(entry) ?? normalize(entry))
      .filter((entry) => entry.length > 0),
  )
  if (selfAddresses.has(sender)) {
    return { allowed: false, reason: 'self-message' }
  }

  if (input.autoSubmitted && normalize(input.autoSubmitted) !== 'no') {
    return { allowed: false, reason: 'auto-submitted' }
  }

  if (NOREPLY_PATTERNS.some((pattern) => pattern.test(sender))) {
    return { allowed: false, reason: 'noreply-sender' }
  }

  return { allowed: true }
}
