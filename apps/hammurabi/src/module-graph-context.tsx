import { createContext, useContext, type ReactNode } from 'react'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'

const ModuleGraphContext = createContext<HammurabiModuleGraphResponse | null>(null)

export function ModuleGraphProvider({
  children,
  graph,
}: {
  children: ReactNode
  graph: HammurabiModuleGraphResponse
}) {
  return (
    <ModuleGraphContext.Provider value={graph}>
      {children}
    </ModuleGraphContext.Provider>
  )
}

export function useModuleGraphContext(): HammurabiModuleGraphResponse | null {
  return useContext(ModuleGraphContext)
}
