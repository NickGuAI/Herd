import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type { HerdModuleGraphResponse } from '@/types/module-graph-api'

export function useModuleGraph({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['module-graph'],
    queryFn: () => fetchJson<HerdModuleGraphResponse>('/api/modules'),
    enabled,
    staleTime: 60_000,
  })
}
