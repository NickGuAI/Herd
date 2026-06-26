import type {
  HerdBodyParserKind,
  HerdModuleStatus,
  HerdRouteAuthMode,
  HerdRouteMetadata,
  HerdRouteSurface,
  HerdUiSurface,
  HerdWebSocketMatchMode,
} from './module-manifest.js'

export interface HerdModuleGraphNavItem {
  moduleId: string
  routeId: string
  path: string
  label: string
  icon: string
  group: 'primary' | 'secondary'
  hidden: boolean
  surfaces: readonly HerdUiSurface[]
  order?: number
}

export interface HerdModuleGraphRoute {
  id: string
  moduleId: string
  surface: HerdRouteSurface
  mount: string
  methods: readonly string[]
  auth: HerdRouteAuthMode
  parserIds: readonly string[]
}

export interface HerdModuleGraphParser {
  id: string
  moduleId: string
  kind: HerdBodyParserKind
  mount: string
  limit?: string
}

export interface HerdModuleGraphWebSocket {
  id: string
  moduleId: string
  path: string
  match: HerdWebSocketMatchMode
  auth: HerdRouteAuthMode
}

export interface HerdModuleGraphStorage {
  moduleId: string
  kind: string
  keys: readonly string[]
  sharedWith: readonly string[]
}

export interface HerdModuleGraphModule {
  id: string
  label: string
  status: HerdModuleStatus
  summary: string
  capabilities: {
    provides: readonly string[]
    consumes: readonly string[]
  }
  dependencies: {
    modules: readonly string[]
    capabilities: readonly string[]
  }
  ui: {
    kind: string
    routes: readonly {
      id: string
      path: string
      componentKey: string
      surfaces: readonly HerdUiSurface[]
      metadata?: HerdRouteMetadata
    }[]
    redirects?: readonly {
      id: string
      from: string
      toRouteId?: string
      toPath?: string
    }[]
    surfaces: readonly HerdUiSurface[]
  }
}

export interface HerdProviderGraphSummary {
  id: string
  label: string
  eventProvider: string
  capabilities: {
    supportsAutomation: boolean
    supportsCommanderConversation: boolean
    supportsWorkerDispatch: boolean
    supportsMessageImages: boolean
  }
  modelIds: readonly string[]
  machineAuth?: {
    cliBinaryName: string
    supportedAuthModes: readonly string[]
    requiresSecretModes: readonly string[]
  }
}

export interface HerdModuleGraphResponse {
  modules: readonly HerdModuleGraphModule[]
  routes: readonly HerdModuleGraphRoute[]
  parsers: readonly HerdModuleGraphParser[]
  websockets: readonly HerdModuleGraphWebSocket[]
  storage: readonly HerdModuleGraphStorage[]
  nav: readonly HerdModuleGraphNavItem[]
  providers: readonly HerdProviderGraphSummary[]
}
