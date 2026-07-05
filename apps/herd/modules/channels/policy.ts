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
  const metadata = event.metadata && typeof event.metadata === 'object'
    ? event.metadata as Record<string, unknown>
    : {}
  const whatsapp = metadata.whatsapp && typeof metadata.whatsapp === 'object'
    ? metadata.whatsapp as Record<string, unknown>
    : {}
  const candidates = [
    event.peerId,
    event.groupId,
    event.threadId,
  ]
  if (isDirect(event)) {
    candidates.push(
      typeof whatsapp.phoneJid === 'string' ? whatsapp.phoneJid : undefined,
      typeof whatsapp.pnJid === 'string' ? whatsapp.pnJid : undefined,
      typeof whatsapp.phoneNumberJid === 'string' ? whatsapp.phoneNumberJid : undefined,
    )
  }
  return candidates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function digitsOnly(value: string): string {
  return value.replace(/\D/gu, '')
}

function jidLocalPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/:\d+@/u, '@')
  const atIndex = normalized.indexOf('@')
  return atIndex >= 0 ? normalized.slice(0, atIndex) : normalized
}

function jidServer(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/:\d+@/u, '@')
  const atIndex = normalized.indexOf('@')
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : null
}

function normalizedWhatsAppJid(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+@/u, '@')
}

function whatsAppGroupValuesMatch(candidate: string, allowed: string): boolean {
  const normalizedCandidate = normalizedWhatsAppJid(candidate)
  const normalizedAllowed = normalizedWhatsAppJid(allowed)
  if (normalizedCandidate === normalizedAllowed) {
    return true
  }
  const candidateServer = jidServer(normalizedCandidate)
  const allowedServer = jidServer(normalizedAllowed)
  if (candidateServer && allowedServer && candidateServer !== allowedServer) {
    return false
  }
  return jidLocalPart(normalizedCandidate) === jidLocalPart(normalizedAllowed)
}

function whatsAppDirectValuesMatch(candidate: string, allowed: string): boolean {
  const normalizedCandidate = normalizedWhatsAppJid(candidate)
  const normalizedAllowed = normalizedWhatsAppJid(allowed)
  if (normalizedCandidate === normalizedAllowed) {
    return true
  }
  const candidateServer = jidServer(normalizedCandidate)
  const allowedServer = jidServer(normalizedAllowed)
  if (candidateServer === 'lid' || allowedServer === 'lid') {
    return false
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
  if (binding.provider === 'whatsapp' && !isDirect(event)) {
    return whatsAppGroupValuesMatch(candidate, allowed)
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
