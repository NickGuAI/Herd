import type { ActionPolicySettings } from './types.js'

export const DEFAULT_STANDING_APPROVAL_EXPIRY_DAYS = 30

export const DEFAULT_ACTION_POLICY_SETTINGS = {
  timeoutMinutes: 15,
  timeoutAction: 'block',
  standingApprovalExpiryDays: DEFAULT_STANDING_APPROVAL_EXPIRY_DAYS,
} satisfies ActionPolicySettings

export function getDefaultActionPolicySettings(): ActionPolicySettings {
  return { ...DEFAULT_ACTION_POLICY_SETTINGS }
}
