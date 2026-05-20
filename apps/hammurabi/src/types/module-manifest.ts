export const HAMMURABI_MODULE_STATUSES = [
  'public',
  'private',
  'embedded',
  'experimental',
  'retired',
] as const

export type HammurabiModuleStatus = (typeof HAMMURABI_MODULE_STATUSES)[number]

export type HammurabiRouteSurface = 'api' | 'ui' | 'redirect'
export type HammurabiRouteAuthMode =
  | 'public'
  | 'api-key'
  | 'auth0'
  | 'api-key-or-auth0'
  | 'pairing-token'
  | 'internal-token'
  | 'webhook'

export type HammurabiBodyParserKind =
  | 'json'
  | 'multipart-memory'
  | 'multipart-disk'
  | 'webhook'
  | 'none'

export type HammurabiWebSocketMatchMode = 'exact' | 'prefix' | 'suffix'
export type HammurabiLifecycleMode = 'none' | 'startup' | 'background' | 'shutdown' | 'combined'
export type HammurabiStorageKind = 'owned' | 'shared' | 'fragment' | 'external' | 'none'
export type HammurabiUiKind = 'route' | 'embedded' | 'global' | 'none'
export type HammurabiUiSurface = 'desktop' | 'mobile' | 'global'
export type HammurabiRouteMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly HammurabiRouteMetadataValue[]
  | { readonly [key: string]: HammurabiRouteMetadataValue }
export type HammurabiRouteMetadata = Readonly<Record<string, HammurabiRouteMetadataValue>>

export interface HammurabiDependencyDeclaration {
  modules: readonly string[]
  capabilities: readonly string[]
  optionalModules?: readonly string[]
}

export interface HammurabiCapabilityDeclaration {
  provides: readonly string[]
  consumes: readonly string[]
}

export interface HammurabiBrowserUiRoute {
  id: string
  path: string
  componentKey: string
  surfaces: readonly HammurabiUiSurface[]
  metadata?: HammurabiRouteMetadata
  nav?: {
    label: string
    icon: string
    group: 'primary' | 'secondary'
    hidden?: boolean
    surfaces?: readonly HammurabiUiSurface[]
    order?: number
  }
}

export interface HammurabiBrowserUiRedirect {
  id: string
  from: string
  toRouteId?: string
  toPath?: string
}

export interface HammurabiBrowserUiMetadata {
  kind: HammurabiUiKind
  routes: readonly HammurabiBrowserUiRoute[]
  redirects?: readonly HammurabiBrowserUiRedirect[]
  componentKeys: readonly string[]
  surfaces: readonly HammurabiUiSurface[]
}

export interface HammurabiModuleBrowserGraphMetadata {
  id: string
  label: string
  directory: string
  status: HammurabiModuleStatus
  summary: string
  dependencies: HammurabiDependencyDeclaration
  capabilities: HammurabiCapabilityDeclaration
  ui: HammurabiBrowserUiMetadata
  routeIds: readonly string[]
  parserIds: readonly string[]
  websocketIds: readonly string[]
  storageKeys: readonly string[]
}

export interface HammurabiRouteDeclaration {
  id: string
  surface: HammurabiRouteSurface
  mount: string
  methods: readonly string[]
  auth: HammurabiRouteAuthMode
  ownerModuleId: string
  parserIds?: readonly string[]
  notes?: string
}

export interface HammurabiParserDeclaration {
  id: string
  kind: HammurabiBodyParserKind
  mount: string
  ownerModuleId: string
  limit?: string
  notes?: string
}

export interface HammurabiWebSocketDeclaration {
  id: string
  path: string
  match: HammurabiWebSocketMatchMode
  auth: HammurabiRouteAuthMode
  ownerModuleId: string
  notes?: string
}

export interface HammurabiLifecycleHookDeclaration {
  id: string
  ownerModuleId: string
  notes: string
}

export interface HammurabiLifecycleDeclaration {
  mode: HammurabiLifecycleMode
  startup: readonly HammurabiLifecycleHookDeclaration[]
  background: readonly HammurabiLifecycleHookDeclaration[]
  shutdown: readonly HammurabiLifecycleHookDeclaration[]
}

export interface HammurabiStorageOwnership {
  kind: HammurabiStorageKind
  ownerModuleId: string
  keys: readonly string[]
  roots: readonly string[]
  files: readonly string[]
  sharedWith?: readonly string[]
  notes: string
}

export interface HammurabiModuleServerMetadata {
  id: string
  directory: string
  serverOnly: true
  routes: readonly HammurabiRouteDeclaration[]
  parsers: readonly HammurabiParserDeclaration[]
  websockets: readonly HammurabiWebSocketDeclaration[]
  lifecycle: HammurabiLifecycleDeclaration
  storage: HammurabiStorageOwnership
  dependencies: HammurabiDependencyDeclaration
  capabilities: HammurabiCapabilityDeclaration
}

export interface HammurabiModuleManifest {
  graph: HammurabiModuleBrowserGraphMetadata
  server: HammurabiModuleServerMetadata
}
