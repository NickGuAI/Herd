import { useContext } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  AgentType,
  ProviderRegistryEntry,
  ProviderRegistryResponse,
} from '@/types'

const fallbackQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

async function fetchProviderRegistry(): Promise<ProviderRegistryEntry[]> {
  const response = await fetchJson<ProviderRegistryResponse | ProviderRegistryEntry[]>('/api/providers')
  if (Array.isArray(response)) {
    return response
  }
  return Array.isArray(response?.providers) ? response.providers : []
}

export function useProviderRegistry() {
  const queryClient = useContext(QueryClientContext)
  const hasQueryClient = queryClient !== undefined

  return useQuery({
    queryKey: ['providers'],
    queryFn: fetchProviderRegistry,
    staleTime: hasQueryClient ? 60_000 : Infinity,
    enabled: hasQueryClient,
    initialData: hasQueryClient ? undefined : [],
  }, queryClient ?? fallbackQueryClient)
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
  return findProviderEntry(providers, providerId)?.label ?? (providerId ?? 'claude')
}
