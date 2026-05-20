import { randomBytes } from 'node:crypto'
import type { Router } from 'express'
import type { AgentSessionMonitorOptions } from '@gehirn/ai-services'
import {
  createHammurabiCapabilityContainer,
  loadHammurabiModules,
  type HammurabiCapabilitySnapshot,
  type LoadedHammurabiModuleGraph,
} from './module-loader.js'
import {
  createManifestMountedModules,
  type HammurabiModule,
  type ModuleRegistryOptions,
} from './module-runtime.js'
import type { HammurabiRuntimeCapabilities } from './module-runtime-capabilities.js'
import { createHammurabiModuleRuntimeRegistrations } from './module-runtime-factories.js'

export type { HammurabiModule, ModuleRegistryOptions } from './module-runtime.js'

export interface ModuleRegistryResult {
  modules: HammurabiModule[]
  /** OTEL receiver router — mount at `/v1` (separate from module prefixes). */
  otelRouter: Router
  moduleGraph: LoadedHammurabiModuleGraph
  capabilities: HammurabiCapabilitySnapshot
}

const DEFAULT_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES = 30
const DEFAULT_COMMAND_ROOM_POLL_INTERVAL_MS = 5_000

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function resolveCommandRoomMonitorOptions(
  env: NodeJS.ProcessEnv = process.env,
): AgentSessionMonitorOptions {
  const pollIntervalMs =
    parsePositiveInteger(env.HAMMURABI_COMMAND_ROOM_POLL_INTERVAL_MS)
    ?? DEFAULT_COMMAND_ROOM_POLL_INTERVAL_MS
  const staleSessionTtlMinutes =
    parsePositiveInteger(env.HAMMURABI_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES)
    ?? DEFAULT_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES

  return {
    pollIntervalMs,
    maxPollAttempts: Math.max(1, Math.ceil((staleSessionTtlMinutes * 60_000) / pollIntervalMs)),
  }
}

export function createModules(options: ModuleRegistryOptions = {}): ModuleRegistryResult {
  const moduleGraph = loadHammurabiModules()
  const capabilities = createHammurabiCapabilityContainer<HammurabiRuntimeCapabilities>()
  const runtime = createHammurabiModuleRuntimeRegistrations({
    options,
    moduleGraph,
    capabilities,
    internalToken: randomBytes(32).toString('hex'),
    commandRoomMonitorOptions: resolveCommandRoomMonitorOptions(),
  })

  return {
    modules: createManifestMountedModules(moduleGraph, runtime.registrations),
    otelRouter: runtime.otelRouter,
    moduleGraph,
    capabilities: capabilities.snapshot(),
  }
}
