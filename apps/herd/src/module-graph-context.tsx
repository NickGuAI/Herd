import { createContext, useContext, type ReactNode } from 'react'
import type { HerdModuleGraphResponse } from '@/types/module-graph-api'

const ModuleGraphContext = createContext<HerdModuleGraphResponse | null>(null)

export function ModuleGraphProvider({
  children,
  graph,
}: {
  children: ReactNode
  graph: HerdModuleGraphResponse
}) {
  return (
    <ModuleGraphContext.Provider value={graph}>
      {children}
    </ModuleGraphContext.Provider>
  )
}

export function useModuleGraphContext(): HerdModuleGraphResponse | null {
  return useContext(ModuleGraphContext)
}
