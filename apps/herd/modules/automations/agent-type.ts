import {
  getProvider,
  listProviders,
  parseProviderId,
  resolveAutomationDefaultProviderId,
} from '../agents/providers/registry.js'
import type { AgentType } from '../agents/types.js'

/**
 * Shared automation provider validation.
 *
 * Every path that creates an automation (the `/api/automations` route, the
 * Command Room create flow, and commander bundle imports) must agree on what a
 * valid automation `agentType` is: a registered provider whose capabilities
 * include `supportsAutomation`.
 */
export function parseOptionalAutomationAgentType(raw: unknown): AgentType | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  const agentType = parseProviderId(raw)
  return agentType && getProvider(agentType)?.capabilities.supportsAutomation
    ? agentType
    : null
}

export function resolveDefaultAutomationAgentType(): AgentType | null {
  const projectedDefault = resolveAutomationDefaultProviderId()
  if (getProvider(projectedDefault)?.capabilities.supportsAutomation) {
    return projectedDefault
  }
  return listProviders().find((provider) => provider.capabilities.supportsAutomation)?.id ?? null
}
