import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'

export function useModuleGraph({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['module-graph'],
    queryFn: () => fetchJson<HammurabiModuleGraphResponse>('/api/modules'),
    enabled,
    staleTime: 60_000,
  })
}
