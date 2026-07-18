import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeMaxThinkingTokens } from '../../claude-max-thinking-tokens.js'
import {
  isClaudeAdaptiveThinkingMode,
} from '../../claude-adaptive-thinking.js'
import {
  normalizeAgentEffort,
  type AgentEffortLevel,
} from '../effort.js'
import {
  isClaudeMaxThinkingTokens,
} from '../../claude-max-thinking-tokens.js'
import {
  getProvider,
  parseProviderId,
} from './registry.js'
import type { ProviderSessionContext } from './provider-session-context.js'

export type ProviderContext = ProviderSessionContext

type ProviderContextParseOptions = {
  effort?: AgentEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function readProviderEffort(
  providerId: string,
  value: unknown,
  fallback?: AgentEffortLevel,
): AgentEffortLevel | undefined {
  return normalizeAgentEffort(providerId, value, fallback)
}

function readClaudeAdaptiveThinking(
  value: unknown,
  fallback?: ClaudeAdaptiveThinkingMode,
): ClaudeAdaptiveThinkingMode | undefined {
  if (isClaudeAdaptiveThinkingMode(value)) {
    return value
  }
  return fallback
}

function readClaudeMaxThinkingTokens(
  value: unknown,
  fallback?: ClaudeMaxThinkingTokens,
): ClaudeMaxThinkingTokens | undefined {
  if (isClaudeMaxThinkingTokens(value)) {
    return value
  }
  return fallback
}

function sanitizeSerializableValue(value: unknown): unknown | undefined {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return asOptionalString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    const next = value
      .map((entry) => sanitizeSerializableValue(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    return next.length > 0 ? next : undefined
  }

  if (!isPlainObject(value)) {
    return undefined
  }

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeSerializableValue(entry)
    if (sanitized !== undefined) {
      next[key] = sanitized
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function buildCanonicalProviderContext(
  providerId: string,
  raw: Record<string, unknown>,
  options: ProviderContextParseOptions = {},
): ProviderContext | null {
  const provider = getProvider(providerId)
  if (!provider) {
    return null
  }

  const next: Record<string, unknown> = { providerId }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'providerId' || key === 'effort' || key === 'adaptiveThinking' || key === 'maxThinkingTokens') {
      continue
    }
    const sanitized = sanitizeSerializableValue(value)
    if (sanitized !== undefined) {
      next[key] = sanitized
    }
  }

  if (provider.uiCapabilities.supportsEffort && raw.omitEffort !== true) {
    const effort = readProviderEffort(providerId, raw.effort, options.effort)
    if (effort) {
      next.effort = effort
    }
  }

  if (provider.uiCapabilities.supportsAdaptiveThinking) {
    const adaptiveThinking = readClaudeAdaptiveThinking(
      raw.adaptiveThinking,
      options.adaptiveThinking,
    )
    if (adaptiveThinking) {
      next.adaptiveThinking = adaptiveThinking
    }
  }

  if (provider.uiCapabilities.supportsMaxThinkingTokens) {
    const maxThinkingTokens = readClaudeMaxThinkingTokens(
      raw.maxThinkingTokens,
      options.maxThinkingTokens,
    )
    if (maxThinkingTokens) {
      next.maxThinkingTokens = maxThinkingTokens
    }
  }

  return next as unknown as ProviderContext
}

export function sanitizeProviderContextForPersistence(
  providerContext: ProviderContext | null | undefined,
  options: ProviderContextParseOptions = {},
): ProviderContext | null {
  if (!isObject(providerContext)) {
    return null
  }

  const providerId = parseProviderId(providerContext.providerId)
  if (!providerId) {
    return null
  }

  return buildCanonicalProviderContext(providerId, providerContext, options)
}

export function parseCanonicalProviderContext(
  value: unknown,
  options: ProviderContextParseOptions = {},
): ProviderContext | null {
  if (!isObject(value)) {
    return null
  }

  const providerId = parseProviderId(value.providerId)
  if (!providerId) {
    return null
  }

  return buildCanonicalProviderContext(providerId, value, options)
}
