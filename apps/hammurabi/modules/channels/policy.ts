import type {
  ChannelInboundDecision,
  ChannelInboundEvent,
  ChannelPolicyMode,
  CommanderChannelBinding,
} from './types.js'

const POLICY_VALUES = new Set<ChannelPolicyMode>(['open', 'allowlist', 'disabled'])

function asPolicyMode(value: unknown, fallback: ChannelPolicyMode): ChannelPolicyMode {
  return typeof value === 'string' && POLICY_VALUES.has(value as ChannelPolicyMode)
    ? value as ChannelPolicyMode
    : fallback
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function isDirect(event: Pick<ChannelInboundEvent, 'chatType'>): boolean {
  return event.chatType === 'direct' || event.chatType === 'dm'
}

function candidateIds(event: ChannelInboundEvent): string[] {
  return [
    event.peerId,
    event.groupId,
    event.threadId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function digitsOnly(value: string): string {
  return value.replace(/\D/gu, '')
}

function jidLocalPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/:\d+@/u, '@')
  const atIndex = normalized.indexOf('@')
  return atIndex >= 0 ? normalized.slice(0, atIndex) : normalized
}

function whatsAppDirectValuesMatch(candidate: string, allowed: string): boolean {
  const normalizedCandidate = candidate.trim().toLowerCase().replace(/:\d+@/u, '@')
  const normalizedAllowed = allowed.trim().toLowerCase().replace(/:\d+@/u, '@')
  if (normalizedCandidate === normalizedAllowed) {
    return true
  }

  const candidateDigits = digitsOnly(jidLocalPart(normalizedCandidate))
  const allowedDigits = digitsOnly(jidLocalPart(normalizedAllowed))
  if (candidateDigits.length === 0 || allowedDigits.length < 10) {
    return false
  }
  return candidateDigits === allowedDigits || candidateDigits.endsWith(allowedDigits)
}

function valuesMatch(
  binding: CommanderChannelBinding,
  event: ChannelInboundEvent,
  candidate: string,
  allowed: string,
): boolean {
  if (binding.provider === 'email') {
    return candidate.trim().toLowerCase() === allowed.trim().toLowerCase()
  }
  if (binding.provider === 'whatsapp' && isDirect(event)) {
    return whatsAppDirectValuesMatch(candidate, allowed)
  }
  return candidate === allowed
}

function isTrustedSelfChat(event: ChannelInboundEvent): boolean {
  return event.provider === 'whatsapp'
    && isDirect(event)
    && event.metadata?.selfAuthored === true
    && event.metadata?.selfChat === true
}

export function checkAccountInboundPolicy(
  binding: CommanderChannelBinding,
  event: ChannelInboundEvent,
): ChannelInboundDecision {
  if (!binding.enabled) {
    return { allowed: false, reason: 'binding-disabled' }
  }

  const config = binding.config ?? {}
  const direct = isDirect(event)
  const policy = direct
    ? asPolicyMode(config.dmPolicy, 'disabled')
    : asPolicyMode(config.groupPolicy, 'disabled')

  if (policy === 'open') {
    return { allowed: true, reason: 'policy-open' }
  }
  if (policy === 'disabled') {
    return { allowed: false, reason: direct ? 'dm-disabled' : 'group-disabled' }
  }
  if (isTrustedSelfChat(event)) {
    return { allowed: true, reason: 'trusted-self-chat' }
  }

  const allowlist = [
    ...asStringList(direct ? config.dmAllowlist : config.groupAllowlist),
    ...asStringList(config.allowlist),
    ...asStringList(config.globalAllowlist),
  ]
  const candidates = candidateIds(event)
  const allowed = candidates.some((candidate) => (
    allowlist.some((entry) => valuesMatch(binding, event, candidate, entry))
  ))
  return allowed
    ? { allowed: true, reason: 'allowlist' }
    : { allowed: false, reason: 'allowlist-deny' }
}
