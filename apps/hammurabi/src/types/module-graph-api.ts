import type {
  HammurabiBodyParserKind,
  HammurabiModuleStatus,
  HammurabiRouteAuthMode,
  HammurabiRouteMetadata,
  HammurabiRouteSurface,
  HammurabiUiSurface,
  HammurabiWebSocketMatchMode,
} from './module-manifest.js'

export interface HammurabiModuleGraphNavItem {
  moduleId: string
  routeId: string
  path: string
  label: string
  icon: string
  group: 'primary' | 'secondary'
  hidden: boolean
  surfaces: readonly HammurabiUiSurface[]
  order?: number
}

export interface HammurabiModuleGraphRoute {
  id: string
  moduleId: string
  surface: HammurabiRouteSurface
  mount: string
  methods: readonly string[]
  auth: HammurabiRouteAuthMode
  parserIds: readonly string[]
}

export interface HammurabiModuleGraphParser {
  id: string
  moduleId: string
  kind: HammurabiBodyParserKind
  mount: string
  limit?: string
}

export interface HammurabiModuleGraphWebSocket {
  id: string
  moduleId: string
  path: string
  match: HammurabiWebSocketMatchMode
  auth: HammurabiRouteAuthMode
}

export interface HammurabiModuleGraphStorage {
  moduleId: string
  kind: string
  keys: readonly string[]
  sharedWith: readonly string[]
}

export interface HammurabiModuleGraphModule {
  id: string
  label: string
  status: HammurabiModuleStatus
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
      surfaces: readonly HammurabiUiSurface[]
      metadata?: HammurabiRouteMetadata
    }[]
    redirects?: readonly {
      id: string
      from: string
      toRouteId?: string
      toPath?: string
    }[]
    surfaces: readonly HammurabiUiSurface[]
  }
}

export interface HammurabiProviderGraphSummary {
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

export interface HammurabiModuleGraphResponse {
  modules: readonly HammurabiModuleGraphModule[]
  routes: readonly HammurabiModuleGraphRoute[]
  parsers: readonly HammurabiModuleGraphParser[]
  websockets: readonly HammurabiModuleGraphWebSocket[]
  storage: readonly HammurabiModuleGraphStorage[]
  nav: readonly HammurabiModuleGraphNavItem[]
  providers: readonly HammurabiProviderGraphSummary[]
}
