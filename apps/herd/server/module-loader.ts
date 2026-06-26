import {
  HERD_MODULE_MANIFESTS,
  type HERD_MODULE_SERVER_METADATA,
} from './module-manifest.js'
import type {
  HerdLifecycleDeclaration,
  HerdModuleManifest,
  HerdParserDeclaration,
  HerdRouteDeclaration,
  HerdStorageOwnership,
  HerdWebSocketDeclaration,
} from '../src/types/module-manifest.js'

export const HERD_EXTERNAL_CAPABILITIES = ['auth.user'] as const

export interface HerdModuleMountPlan {
  routes: readonly HerdRouteDeclaration[]
  parsers: readonly HerdParserDeclaration[]
  websockets: readonly HerdWebSocketDeclaration[]
  lifecycles: readonly HerdLifecycleDeclaration[]
  storage: readonly HerdStorageOwnership[]
}

export interface LoadedHerdModuleGraph {
  manifests: readonly HerdModuleManifest[]
  manifestById: ReadonlyMap<string, HerdModuleManifest>
  capabilityProviders: ReadonlyMap<string, string>
  capabilityConsumers: ReadonlyMap<string, readonly string[]>
  mountPlan: HerdModuleMountPlan
}

export interface LoadHerdModulesOptions {
  manifests?: readonly HerdModuleManifest[]
  enabledModuleIds?: readonly string[]
  externalCapabilities?: readonly string[]
}

export class HerdModuleLoaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HerdModuleLoaderError'
  }
}

export interface HerdCapabilitySnapshot {
  providers: ReadonlyMap<string, string>
  consumers: ReadonlyMap<string, readonly string[]>
}

type CapabilityKey<TCapabilities extends object> = Extract<keyof TCapabilities, string>

export class HerdCapabilityContainer<TCapabilities extends object = Record<string, unknown>> {
  private readonly providers = new Map<CapabilityKey<TCapabilities>, { moduleId: string; value: unknown }>()
  private readonly consumers = new Map<CapabilityKey<TCapabilities>, Set<string>>()
  private activeProviderModuleId: string | null = null

  withProviderModule<T>(moduleId: string, operation: () => T): T {
    const previousProviderModuleId = this.activeProviderModuleId
    this.activeProviderModuleId = moduleId
    try {
      return operation()
    } finally {
      this.activeProviderModuleId = previousProviderModuleId
    }
  }

  provide<TKey extends CapabilityKey<TCapabilities>>(
    capabilityId: TKey,
    ownerModuleId: string,
    value: TCapabilities[TKey],
  ): void {
    if (this.activeProviderModuleId && ownerModuleId !== this.activeProviderModuleId) {
      throw new HerdModuleLoaderError(
        `Runtime module "${this.activeProviderModuleId}" cannot provide capability "${capabilityId}" `
        + `as owner "${ownerModuleId}"`,
      )
    }

    const existing = this.providers.get(capabilityId)
    if (existing) {
      throw new HerdModuleLoaderError(
        `Capability "${capabilityId}" is already provided by module "${existing.moduleId}"`,
      )
    }

    this.providers.set(capabilityId, { moduleId: ownerModuleId, value })
  }

  consume<TKey extends CapabilityKey<TCapabilities>>(capabilityId: TKey, consumerModuleId: string): TCapabilities[TKey] {
    const provider = this.providers.get(capabilityId)
    if (!provider) {
      throw new HerdModuleLoaderError(
        `Module "${consumerModuleId}" consumes undeclared capability "${capabilityId}"`,
      )
    }

    const consumers = this.consumers.get(capabilityId) ?? new Set<string>()
    consumers.add(consumerModuleId)
    this.consumers.set(capabilityId, consumers)

    return provider.value as TCapabilities[TKey]
  }

  has(capabilityId: CapabilityKey<TCapabilities>): boolean {
    return this.providers.has(capabilityId)
  }

  snapshot(): HerdCapabilitySnapshot {
    return {
      providers: new Map([...this.providers.entries()].map(([id, provider]) => [id, provider.moduleId])),
      consumers: new Map([...this.consumers.entries()].map(([id, consumers]) => [id, [...consumers].sort()])),
    }
  }
}

export function createHerdCapabilityContainer<
  TCapabilities extends object = Record<string, unknown>,
>(): HerdCapabilityContainer<TCapabilities> {
  return new HerdCapabilityContainer<TCapabilities>()
}

export function loadHerdModules(options: LoadHerdModulesOptions = {}): LoadedHerdModuleGraph {
  const manifests = options.manifests ?? HERD_MODULE_MANIFESTS
  const externalCapabilities = new Set(options.externalCapabilities ?? HERD_EXTERNAL_CAPABILITIES)
  const enabledModuleIds = options.enabledModuleIds
    ? new Set(options.enabledModuleIds)
    : new Set(manifests.filter((manifest) => manifest.graph.status !== 'retired').map((manifest) => manifest.graph.id))
  const enabledManifests = manifests.filter((manifest) => enabledModuleIds.has(manifest.graph.id))

  validateModuleIdentities(manifests)
  validateEnabledDependencies(enabledManifests, enabledModuleIds)

  const capabilityProviders = validateCapabilityProviders(enabledManifests)
  validateCapabilityDependencies(enabledManifests, capabilityProviders, externalCapabilities)
  const capabilityConsumers = validateCapabilityConsumers(enabledManifests, capabilityProviders, externalCapabilities)
  const mountPlan = buildMountPlan(enabledManifests)

  return {
    manifests: enabledManifests,
    manifestById: new Map(enabledManifests.map((manifest) => [manifest.graph.id, manifest])),
    capabilityProviders,
    capabilityConsumers,
    mountPlan,
  }
}

function validateCapabilityDependencies(
  manifests: readonly HerdModuleManifest[],
  providers: ReadonlyMap<string, string>,
  externalCapabilities: ReadonlySet<string>,
): void {
  for (const manifest of manifests) {
    for (const capabilityId of manifest.graph.dependencies.capabilities) {
      if (!providers.has(capabilityId) && !externalCapabilities.has(capabilityId)) {
        throw new HerdModuleLoaderError(
          `Module "${manifest.graph.id}" depends on undeclared capability "${capabilityId}"`,
        )
      }
    }
  }
}

function validateModuleIdentities(manifests: readonly HerdModuleManifest[]): void {
  const ids = new Set<string>()

  for (const manifest of manifests) {
    if (manifest.graph.id !== manifest.server.id) {
      throw new HerdModuleLoaderError(
        `Module graph/server id mismatch: "${manifest.graph.id}" vs "${manifest.server.id}"`,
      )
    }
    if (manifest.graph.directory !== manifest.server.directory) {
      throw new HerdModuleLoaderError(
        `Module "${manifest.graph.id}" graph/server directory mismatch`,
      )
    }
    if (ids.has(manifest.graph.id)) {
      throw new HerdModuleLoaderError(`Duplicate module id "${manifest.graph.id}"`)
    }
    ids.add(manifest.graph.id)
  }
}

function validateEnabledDependencies(
  manifests: readonly HerdModuleManifest[],
  enabledModuleIds: ReadonlySet<string>,
): void {
  for (const manifest of manifests) {
    for (const dependency of manifest.graph.dependencies.modules) {
      if (!enabledModuleIds.has(dependency)) {
        throw new HerdModuleLoaderError(
          `Module "${manifest.graph.id}" depends on disabled or missing module "${dependency}"`,
        )
      }
    }
  }
}

function validateCapabilityProviders(
  manifests: readonly HerdModuleManifest[],
): ReadonlyMap<string, string> {
  const providers = new Map<string, string>()

  for (const manifest of manifests) {
    for (const capabilityId of manifest.graph.capabilities.provides) {
      const existing = providers.get(capabilityId)
      if (existing) {
        throw new HerdModuleLoaderError(
          `Capability "${capabilityId}" is provided by both "${existing}" and "${manifest.graph.id}"`,
        )
      }
      providers.set(capabilityId, manifest.graph.id)
    }
  }

  return providers
}

function validateCapabilityConsumers(
  manifests: readonly HerdModuleManifest[],
  providers: ReadonlyMap<string, string>,
  externalCapabilities: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const consumers = new Map<string, string[]>()

  for (const manifest of manifests) {
    for (const capabilityId of manifest.graph.capabilities.consumes) {
      if (!providers.has(capabilityId) && !externalCapabilities.has(capabilityId)) {
        throw new HerdModuleLoaderError(
          `Module "${manifest.graph.id}" consumes undeclared capability "${capabilityId}"`,
        )
      }

      const nextConsumers = consumers.get(capabilityId) ?? []
      nextConsumers.push(manifest.graph.id)
      consumers.set(capabilityId, nextConsumers)
    }
  }

  return new Map([...consumers.entries()].map(([id, moduleIds]) => [id, moduleIds.sort()]))
}

function buildMountPlan(manifests: readonly HerdModuleManifest[]): HerdModuleMountPlan {
  const routes = manifests.flatMap((manifest) => validateOwnedRoutes(manifest))
  const parsers = manifests.flatMap((manifest) => validateOwnedParsers(manifest))
  const websockets = manifests.flatMap((manifest) => validateOwnedWebsockets(manifest))
  const lifecycles = manifests.map((manifest) => validateOwnedLifecycle(manifest))
  const storage = manifests.map((manifest) => validateOwnedStorage(manifest))

  assertNoDuplicateIds('route', routes.map((route) => route.id))
  assertNoDuplicateIds('parser', parsers.map((parser) => parser.id))
  assertNoDuplicateIds('websocket', websockets.map((socket) => socket.id))
  assertNoDuplicateIds('websocket path', websockets.map((socket) => socket.path))
  assertNoDuplicateOwnedStorageKeys(storage)

  return {
    routes,
    parsers,
    websockets,
    lifecycles,
    storage,
  }
}

function validateOwnedRoutes(manifest: HerdModuleManifest): readonly HerdRouteDeclaration[] {
  const parserIds = new Set(manifest.server.parsers.map((parser) => parser.id))

  for (const route of manifest.server.routes) {
    if (route.ownerModuleId !== manifest.server.id) {
      throw new HerdModuleLoaderError(
        `Route "${route.id}" is declared by "${manifest.server.id}" but owned by "${route.ownerModuleId}"`,
      )
    }

    for (const parserId of route.parserIds ?? []) {
      if (!parserIds.has(parserId)) {
        throw new HerdModuleLoaderError(
          `Route "${route.id}" references parser "${parserId}" not declared by module "${manifest.server.id}"`,
        )
      }
    }
  }

  return manifest.server.routes
}

function validateOwnedParsers(manifest: HerdModuleManifest): readonly HerdParserDeclaration[] {
  for (const parser of manifest.server.parsers) {
    if (parser.ownerModuleId !== manifest.server.id) {
      throw new HerdModuleLoaderError(
        `Parser "${parser.id}" is declared by "${manifest.server.id}" but owned by "${parser.ownerModuleId}"`,
      )
    }
  }

  return manifest.server.parsers
}

function validateOwnedWebsockets(manifest: HerdModuleManifest): readonly HerdWebSocketDeclaration[] {
  for (const websocket of manifest.server.websockets) {
    if (websocket.ownerModuleId !== manifest.server.id) {
      throw new HerdModuleLoaderError(
        `WebSocket "${websocket.id}" is declared by "${manifest.server.id}" but owned by "${websocket.ownerModuleId}"`,
      )
    }
    if (websocket.match !== 'exact') {
      throw new HerdModuleLoaderError(
        `WebSocket "${websocket.id}" must use exact manifest matching`,
      )
    }
  }

  return manifest.server.websockets
}

function validateOwnedLifecycle(manifest: HerdModuleManifest): HerdLifecycleDeclaration {
  const { lifecycle } = manifest.server
  for (const hook of [...lifecycle.startup, ...lifecycle.background, ...lifecycle.shutdown]) {
    if (hook.ownerModuleId !== manifest.server.id) {
      throw new HerdModuleLoaderError(
        `Lifecycle hook "${hook.id}" is declared by "${manifest.server.id}" but owned by "${hook.ownerModuleId}"`,
      )
    }
  }

  return lifecycle
}

function validateOwnedStorage(manifest: HerdModuleManifest): HerdStorageOwnership {
  if (manifest.server.storage.ownerModuleId !== manifest.server.id) {
    throw new HerdModuleLoaderError(
      `Storage for "${manifest.server.id}" is owned by "${manifest.server.storage.ownerModuleId}"`,
    )
  }

  return manifest.server.storage
}

function assertNoDuplicateIds(kind: string, ids: readonly string[]): void {
  const seen = new Set<string>()

  for (const id of ids) {
    if (seen.has(id)) {
      throw new HerdModuleLoaderError(`Duplicate ${kind} id "${id}"`)
    }
    seen.add(id)
  }
}

function assertNoDuplicateOwnedStorageKeys(storage: readonly HerdStorageOwnership[]): void {
  const ownersByKey = new Map<string, string>()

  for (const entry of storage) {
    if (entry.kind !== 'owned') {
      continue
    }

    for (const key of entry.keys) {
      const existingOwner = ownersByKey.get(key)
      if (existingOwner) {
        throw new HerdModuleLoaderError(
          `Storage key "${key}" is owned by both "${existingOwner}" and "${entry.ownerModuleId}"`,
        )
      }
      ownersByKey.set(key, entry.ownerModuleId)
    }
  }
}

export type HerdModuleServerMetadataInventory = typeof HERD_MODULE_SERVER_METADATA
