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

  const allowlist = [
    ...asStringList(direct ? config.dmAllowlist : config.groupAllowlist),
    ...asStringList(config.allowlist),
  ]
  const allowed = candidateIds(event).some((candidate) => allowlist.includes(candidate))
  return allowed
    ? { allowed: true, reason: 'allowlist' }
    : { allowed: false, reason: 'allowlist-deny' }
}
