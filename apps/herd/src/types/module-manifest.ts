export const HERD_MODULE_STATUSES = [
  'public',
  'private',
  'embedded',
  'experimental',
  'retired',
] as const

export type HerdModuleStatus = (typeof HERD_MODULE_STATUSES)[number]

export type HerdRouteSurface = 'api' | 'ui' | 'redirect'
export type HerdRouteAuthMode =
  | 'public'
  | 'api-key'
  | 'auth0'
  | 'api-key-or-auth0'
  | 'pairing-token'
  | 'internal-token'
  | 'webhook'

export type HerdBodyParserKind =
  | 'json'
  | 'multipart-memory'
  | 'multipart-disk'
  | 'webhook'
  | 'none'

export type HerdWebSocketMatchMode = 'exact' | 'prefix' | 'suffix'
export type HerdLifecycleMode = 'none' | 'startup' | 'background' | 'shutdown' | 'combined'
export type HerdStorageKind = 'owned' | 'shared' | 'fragment' | 'external' | 'none'
export type HerdUiKind = 'route' | 'embedded' | 'global' | 'none'
export type HerdUiSurface = 'desktop' | 'mobile' | 'global'
export type HerdRouteMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly HerdRouteMetadataValue[]
  | { readonly [key: string]: HerdRouteMetadataValue }
export type HerdRouteMetadata = Readonly<Record<string, HerdRouteMetadataValue>>

export interface HerdDependencyDeclaration {
  modules: readonly string[]
  capabilities: readonly string[]
  optionalModules?: readonly string[]
}

export interface HerdCapabilityDeclaration {
  provides: readonly string[]
  consumes: readonly string[]
}

export interface HerdBrowserUiRoute {
  id: string
  path: string
  componentKey: string
  surfaces: readonly HerdUiSurface[]
  metadata?: HerdRouteMetadata
  nav?: {
    label: string
    icon: string
    group: 'primary' | 'secondary'
    hidden?: boolean
    surfaces?: readonly HerdUiSurface[]
    order?: number
  }
}

export interface HerdBrowserUiRedirect {
  id: string
  from: string
  toRouteId?: string
  toPath?: string
}

export interface HerdBrowserUiMetadata {
  kind: HerdUiKind
  routes: readonly HerdBrowserUiRoute[]
  redirects?: readonly HerdBrowserUiRedirect[]
  componentKeys: readonly string[]
  surfaces: readonly HerdUiSurface[]
}

export interface HerdModuleBrowserGraphMetadata {
  id: string
  label: string
  directory: string
  status: HerdModuleStatus
  summary: string
  dependencies: HerdDependencyDeclaration
  capabilities: HerdCapabilityDeclaration
  ui: HerdBrowserUiMetadata
  routeIds: readonly string[]
  parserIds: readonly string[]
  websocketIds: readonly string[]
  storageKeys: readonly string[]
}

export interface HerdRouteDeclaration {
  id: string
  surface: HerdRouteSurface
  mount: string
  methods: readonly string[]
  auth: HerdRouteAuthMode
  ownerModuleId: string
  parserIds?: readonly string[]
  notes?: string
}

export interface HerdParserDeclaration {
  id: string
  kind: HerdBodyParserKind
  mount: string
  ownerModuleId: string
  limit?: string
  notes?: string
}

export interface HerdWebSocketDeclaration {
  id: string
  path: string
  match: HerdWebSocketMatchMode
  auth: HerdRouteAuthMode
  ownerModuleId: string
  notes?: string
}

export interface HerdLifecycleHookDeclaration {
  id: string
  ownerModuleId: string
  notes: string
}

export interface HerdLifecycleDeclaration {
  mode: HerdLifecycleMode
  startup: readonly HerdLifecycleHookDeclaration[]
  background: readonly HerdLifecycleHookDeclaration[]
  shutdown: readonly HerdLifecycleHookDeclaration[]
}

export interface HerdStorageOwnership {
  kind: HerdStorageKind
  ownerModuleId: string
  keys: readonly string[]
  roots: readonly string[]
  files: readonly string[]
  sharedWith?: readonly string[]
  notes: string
}

export interface HerdModuleServerMetadata {
  id: string
  directory: string
  serverOnly: true
  routes: readonly HerdRouteDeclaration[]
  parsers: readonly HerdParserDeclaration[]
  websockets: readonly HerdWebSocketDeclaration[]
  lifecycle: HerdLifecycleDeclaration
  storage: HerdStorageOwnership
  dependencies: HerdDependencyDeclaration
  capabilities: HerdCapabilityDeclaration
}

export interface HerdModuleManifest {
  graph: HerdModuleBrowserGraphMetadata
  server: HerdModuleServerMetadata
}
