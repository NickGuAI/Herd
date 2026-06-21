export const COMMANDER_STARTUP_USER_EVENT_SUBTYPE = 'commander_startup'
export const HEARTBEAT_USER_EVENT_SUBTYPE = 'heartbeat'
export const QUEUED_MESSAGE_USER_EVENT_SUBTYPE = 'queued_message'

const HIDDEN_INTERNAL_USER_EVENT_SUBTYPES = new Set<string>([
  COMMANDER_STARTUP_USER_EVENT_SUBTYPE,
  HEARTBEAT_USER_EVENT_SUBTYPE,
])

export function isHiddenInternalUserEventSubtype(subtype: unknown): boolean {
  return typeof subtype === 'string'
    && HIDDEN_INTERNAL_USER_EVENT_SUBTYPES.has(subtype.trim())
}
