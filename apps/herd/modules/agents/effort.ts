import {
  CLAUDE_EFFORT_LEVELS,
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../claude-effort.js'

export const CODEX_EFFORT_LEVELS = ['low', 'medium', 'high', 'max', 'ultra'] as const

export type CodexEffortLevel = (typeof CODEX_EFFORT_LEVELS)[number]
export type AgentEffortLevel = ClaudeEffortLevel | CodexEffortLevel

export const DEFAULT_CODEX_EFFORT_LEVEL: CodexEffortLevel = 'max'

const LEGACY_CODEX_EFFORT_ALIASES = {
  minimal: 'low',
  xhigh: 'max',
} as const satisfies Record<string, CodexEffortLevel>

export function getAgentEffortLevels(agentType: string): readonly AgentEffortLevel[] {
  if (agentType === 'claude') {
    return CLAUDE_EFFORT_LEVELS
  }
  if (agentType === 'codex') {
    return CODEX_EFFORT_LEVELS
  }
  return []
}

export function getAgentEffortLevelsForModel(
  agentType: string,
  model: {
    supportsEffort?: boolean
    supportedEffortLevels?: readonly string[]
  } | null | undefined,
): AgentEffortLevel[] {
  return getAgentModelEffortCapability(agentType, model).supportedEffortLevels
}

export function getAgentModelEffortCapability(
  agentType: string,
  model: {
    supportsEffort?: boolean
    supportedEffortLevels?: readonly string[]
  } | null | undefined,
): {
  supportsEffort: boolean
  supportedEffortLevels: AgentEffortLevel[]
} {
  const providerLevels = getAgentEffortLevels(agentType)
  if (providerLevels.length === 0 || model?.supportsEffort === false) {
    return { supportsEffort: false, supportedEffortLevels: [] }
  }
  const modelLevels = (model?.supportedEffortLevels ?? [])
    .filter((level): level is AgentEffortLevel => providerLevels.includes(level as AgentEffortLevel))
  if (model?.supportedEffortLevels !== undefined) {
    return {
      supportsEffort: modelLevels.length > 0,
      supportedEffortLevels: modelLevels,
    }
  }
  const supportedEffortLevels = agentType === 'codex'
    ? providerLevels.filter((level) => level !== 'ultra')
    : [...providerLevels]
  return {
    supportsEffort: supportedEffortLevels.length > 0,
    supportedEffortLevels,
  }
}

export function getDefaultAgentEffortForModel(
  agentType: string,
  model: {
    supportsEffort?: boolean
    supportedEffortLevels?: readonly string[]
    defaultEffort?: string
  } | null | undefined,
): AgentEffortLevel | undefined {
  const supportedEffortLevels = getAgentEffortLevelsForModel(agentType, model)
  if (supportedEffortLevels.length === 0) {
    return undefined
  }
  const modelDefault = parseOptionalAgentEffort(agentType, model?.defaultEffort)
  if (modelDefault && supportedEffortLevels.includes(modelDefault)) {
    return modelDefault
  }
  const providerDefault = getDefaultAgentEffort(agentType)
  return providerDefault && supportedEffortLevels.includes(providerDefault)
    ? providerDefault
    : supportedEffortLevels[0]
}

export function getDefaultAgentEffort(agentType: string): AgentEffortLevel | undefined {
  if (agentType === 'claude') {
    return DEFAULT_CLAUDE_EFFORT_LEVEL
  }
  if (agentType === 'codex') {
    return DEFAULT_CODEX_EFFORT_LEVEL
  }
  return undefined
}

export function parseOptionalAgentEffort(
  agentType: string,
  value: unknown,
): AgentEffortLevel | undefined | null {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return getAgentEffortLevels(agentType).includes(value as AgentEffortLevel)
    ? value as AgentEffortLevel
    : null
}

/** Parse persisted runtime state, including retired Codex names. Never use for request validation. */
export function parseStoredAgentEffort(
  agentType: string,
  value: unknown,
): AgentEffortLevel | undefined {
  const parsed = parseOptionalAgentEffort(agentType, value)
  if (parsed) {
    return parsed
  }
  if (agentType === 'codex' && typeof value === 'string') {
    return LEGACY_CODEX_EFFORT_ALIASES[
      value.trim() as keyof typeof LEGACY_CODEX_EFFORT_ALIASES
    ]
  }
  return undefined
}

export function normalizeAgentEffort(
  agentType: string,
  value: unknown,
  fallback: AgentEffortLevel | undefined = getDefaultAgentEffort(agentType),
): AgentEffortLevel | undefined {
  const parsed = parseStoredAgentEffort(agentType, value)
  if (parsed) {
    return parsed
  }
  return parseOptionalAgentEffort(agentType, fallback) ?? undefined
}
