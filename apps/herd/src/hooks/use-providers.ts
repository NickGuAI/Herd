import { useContext } from 'react'
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  AgentType,
  CreateSessionInput,
  ProviderRegistryEntry,
  ProviderRegistryResponse,
  ProviderModelsResponse,
  SessionTransportType,
} from '@/types'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../../modules/claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
} from '../../modules/claude-effort.js'
import type { AgentEffortLevel } from '../../modules/agents/effort.js'
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
const PROVIDER_REGISTRY_QUERY_KEY = ['providers'] as const

function providerModelsQueryKey(providerId: AgentType, credentialPoolId?: string) {
  return ['providers', 'models', providerId, credentialPoolId ?? null] as const
}

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
  const activeQueryClient = queryClient ?? fallbackQueryClient

  const query = useQuery({
    queryKey: PROVIDER_REGISTRY_QUERY_KEY,
    queryFn: fetchProviderRegistry,
    staleTime: hasQueryClient ? 60_000 : Infinity,
    enabled: hasQueryClient,
    initialData: hasQueryClient ? undefined : {
      providers: [],
      defaultProviderId: null,
      automationDefaultProviderId: null,
    },
  }, activeQueryClient)

  const refreshModels = useMutation({
    mutationFn: async (input: { providerId: AgentType; credentialPoolId?: string }) => {
      return fetchJson<ProviderModelsResponse>(
        `/api/providers/${encodeURIComponent(input.providerId)}/models/refresh`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...(input.credentialPoolId ? { credentialPoolId: input.credentialPoolId } : {}),
          }),
        },
      )
    },
    onSuccess: async (response, input) => {
      activeQueryClient.setQueryData(
        providerModelsQueryKey(input.providerId, input.credentialPoolId),
        response,
      )
      await activeQueryClient.invalidateQueries({ queryKey: PROVIDER_REGISTRY_QUERY_KEY })
    },
  }, activeQueryClient)

  const registry = toProviderRegistryData(query.data)
  return {
    ...query,
    data: registry.providers,
    providers: registry.providers,
    defaultProviderId: registry.defaultProviderId,
    automationDefaultProviderId: registry.automationDefaultProviderId,
    refreshModels: refreshModels.mutateAsync,
    refreshingProviderId: refreshModels.isPending
      ? refreshModels.variables?.providerId ?? null
      : null,
    isRefreshingModels: refreshModels.isPending,
  }
}

export function useProviderModels(
  providerId: AgentType | null | undefined,
  credentialPoolId?: string,
) {
  const queryClient = useContext(QueryClientContext)
  const hasQueryClient = queryClient !== undefined
  const activeQueryClient = queryClient ?? fallbackQueryClient
  const resolvedProviderId = providerId ?? ''

  return useQuery({
    queryKey: providerModelsQueryKey(resolvedProviderId, credentialPoolId),
    queryFn: () => fetchJson<ProviderModelsResponse>(
      `/api/providers/${encodeURIComponent(resolvedProviderId)}/models${credentialPoolId
        ? `?credentialPoolId=${encodeURIComponent(credentialPoolId)}`
        : ''}`,
    ),
    enabled: hasQueryClient && resolvedProviderId.length > 0,
    staleTime: 60_000,
  }, activeQueryClient)
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
  providers: readonly Pick<ProviderRegistryEntry, 'id' | 'label'>[],
  providerId: AgentType | null | undefined,
): string {
  if (!providerId) {
    return 'Unavailable'
  }
  return providers.find((provider) => provider.id === providerId)?.label ?? providerId
}

function stripProviderModelPrefix(label: string, providerLabel: string | null, providerId: AgentType | null | undefined): string {
  const candidates = [
    providerLabel,
    providerId,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    const pattern = new RegExp(`^${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s:_-]+`, 'i')
    const stripped = label.replace(pattern, '').trim()
    if (stripped !== label && stripped) {
      return stripped
    }
  }

  return label
}

export function getProviderModelLabel(
  providers: readonly Pick<ProviderRegistryEntry, 'id' | 'label' | 'availableModels'>[],
  providerId: AgentType | null | undefined,
  modelId: string | null | undefined,
): string | null {
  const normalizedModel = typeof modelId === 'string' ? modelId.trim() : ''
  if (!normalizedModel) {
    return null
  }

  const provider = providerId ? providers.find((entry) => entry.id === providerId) ?? null : null
  const registryLabel = provider?.availableModels.find((model) => model.id === normalizedModel)?.label
  const label = registryLabel?.trim() || normalizedModel
  return stripProviderModelPrefix(label, provider?.label ?? null, providerId)
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
  effort: AgentEffortLevel
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
  effort: AgentEffortLevel
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
