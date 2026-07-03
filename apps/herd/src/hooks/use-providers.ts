import { useContext } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  AgentType,
  CreateSessionInput,
  ProviderRegistryEntry,
  ProviderRegistryResponse,
  SessionTransportType,
} from '@/types'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../../modules/claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../../modules/claude-effort.js'
import {
  DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  type ClaudeMaxThinkingTokens,
} from '../../modules/claude-max-thinking-tokens.js'

const fallbackQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

interface ProviderRegistryData {
  providers: ProviderRegistryEntry[]
  defaultProviderId: AgentType | null
  automationDefaultProviderId: AgentType | null
}

function toProviderRegistryData(
  value: ProviderRegistryResponse | ProviderRegistryData | undefined,
): ProviderRegistryData {
  const providers = Array.isArray(value?.providers) ? value.providers : []
  const providerIds = new Set(providers.map((provider) => provider.id))
  const defaultProviderId = value?.defaultProviderId && providerIds.has(value.defaultProviderId)
    ? value.defaultProviderId
    : providers[0]?.id ?? null
  const automationDefaultProviderId = value?.automationDefaultProviderId && providerIds.has(value.automationDefaultProviderId)
    ? value.automationDefaultProviderId
    : defaultProviderId

  return {
    providers,
    defaultProviderId,
    automationDefaultProviderId,
  }
}

async function fetchProviderRegistry(): Promise<ProviderRegistryData> {
  const response = await fetchJson<ProviderRegistryResponse>('/api/providers')
  return toProviderRegistryData(response)
}

export function useProviderRegistry() {
  const queryClient = useContext(QueryClientContext)
  const hasQueryClient = queryClient !== undefined

  const query = useQuery({
    queryKey: ['providers'],
    queryFn: fetchProviderRegistry,
    staleTime: hasQueryClient ? 60_000 : Infinity,
    enabled: hasQueryClient,
    initialData: hasQueryClient ? undefined : {
      providers: [],
      defaultProviderId: null,
      automationDefaultProviderId: null,
    },
  }, queryClient ?? fallbackQueryClient)

  const registry = toProviderRegistryData(query.data)
  return {
    ...query,
    data: registry.providers,
    providers: registry.providers,
    defaultProviderId: registry.defaultProviderId,
    automationDefaultProviderId: registry.automationDefaultProviderId,
  }
}

export function findProviderEntry(
  providers: readonly ProviderRegistryEntry[],
  providerId: AgentType | null | undefined,
): ProviderRegistryEntry | null {
  if (!providerId) {
    return null
  }
  return providers.find((provider) => provider.id === providerId) ?? null
}

export function getProviderLabel(
  providers: readonly ProviderRegistryEntry[],
  providerId: AgentType | null | undefined,
): string {
  return findProviderEntry(providers, providerId)?.label ?? (providerId ?? 'Unavailable')
}

export function resolveDefaultProviderId(
  providers: readonly ProviderRegistryEntry[],
  defaultProviderId: AgentType | null | undefined,
  options: {
    predicate?: (provider: ProviderRegistryEntry) => boolean
  } = {},
): AgentType | null {
  const candidates = options.predicate ? providers.filter(options.predicate) : [...providers]
  if (
    defaultProviderId
    && candidates.some((provider) => provider.id === defaultProviderId)
  ) {
    return defaultProviderId
  }
  return candidates[0]?.id ?? null
}

export interface ProviderControlDefaults {
  transportType: Exclude<SessionTransportType, 'external'>
  effort: ClaudeEffortLevel
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  maxThinkingTokens: ClaudeMaxThinkingTokens
}

export function getProviderControlDefaults(
  provider: ProviderRegistryEntry | null | undefined,
): ProviderControlDefaults {
  return {
    transportType: provider?.defaults?.transportType ?? 'stream',
    effort: provider?.defaults?.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
    adaptiveThinking: provider?.defaults?.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
    maxThinkingTokens: provider?.defaults?.maxThinkingTokens ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  }
}

export interface ProviderReasoningControls {
  effort: ClaudeEffortLevel
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  maxThinkingTokens: ClaudeMaxThinkingTokens
}

export interface ProviderReasoningTouched {
  effort?: boolean
  adaptiveThinking?: boolean
  maxThinkingTokens?: boolean
}

export function buildTouchedReasoningPayload(
  provider: ProviderRegistryEntry | null | undefined,
  controls: ProviderReasoningControls,
  touched: ProviderReasoningTouched,
): Pick<CreateSessionInput, 'effort' | 'adaptiveThinking' | 'maxThinkingTokens'> {
  return {
    ...(provider?.uiCapabilities?.supportsEffort && touched.effort
      ? { effort: controls.effort }
      : {}),
    ...(provider?.uiCapabilities?.supportsAdaptiveThinking && touched.adaptiveThinking
      ? { adaptiveThinking: controls.adaptiveThinking }
      : {}),
    ...(provider?.uiCapabilities?.supportsMaxThinkingTokens && touched.maxThinkingTokens
      ? { maxThinkingTokens: controls.maxThinkingTokens }
      : {}),
  }
}
