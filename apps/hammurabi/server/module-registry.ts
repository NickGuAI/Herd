import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
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
const APPROVAL_BRIDGE_SIGNING_SECRET_BYTES = 32
const APPROVAL_BRIDGE_SIGNING_SECRET_FILE = 'approval-bridge-signing-secret'

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

export function resolveApprovalBridgeSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HAMMURABI_APPROVAL_BRIDGE_SIGNING_SECRET?.trim()
  if (configured) {
    return configured
  }

  const dataRoot = env.HAMMURABI_DATA_DIR?.trim()
    ? path.resolve(env.HAMMURABI_DATA_DIR.trim())
    : path.join(homedir(), '.hammurabi')
  const dataDir = path.join(dataRoot, 'policies')
  const secretPath = path.join(dataDir, APPROVAL_BRIDGE_SIGNING_SECRET_FILE)
  if (existsSync(secretPath)) {
    const existing = readFileSync(secretPath, 'utf8').trim()
    if (existing) {
      return existing
    }
  }

  const generated = randomBytes(APPROVAL_BRIDGE_SIGNING_SECRET_BYTES).toString('hex')
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 })
  return generated
}

export function createModules(options: ModuleRegistryOptions = {}): ModuleRegistryResult {
  const moduleGraph = loadHammurabiModules()
  const capabilities = createHammurabiCapabilityContainer<HammurabiRuntimeCapabilities>()
  const runtime = createHammurabiModuleRuntimeRegistrations({
    options,
    moduleGraph,
    capabilities,
    internalToken: randomBytes(32).toString('hex'),
    approvalBridgeSigningSecret: resolveApprovalBridgeSigningSecret(),
    commandRoomMonitorOptions: resolveCommandRoomMonitorOptions(),
  })

  return {
    modules: createManifestMountedModules(moduleGraph, runtime.registrations),
    otelRouter: runtime.otelRouter,
    moduleGraph,
    capabilities: capabilities.snapshot(),
  }
}
