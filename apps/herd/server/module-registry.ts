import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import type { Router } from 'express'
import type { AgentSessionMonitorOptions } from '@gehirn/ai-services'
import {
  createHerdCapabilityContainer,
  loadHerdModules,
  type HerdCapabilitySnapshot,
  type LoadedHerdModuleGraph,
} from './module-loader.js'
import {
  createManifestMountedModules,
  type HerdModule,
  type ModuleRegistryOptions,
} from './module-runtime.js'
import type { HerdRuntimeCapabilities } from './module-runtime-capabilities.js'
import { createHerdModuleRuntimeRegistrations } from './module-runtime-factories.js'

export type { HerdModule, ModuleRegistryOptions } from './module-runtime.js'

export interface ModuleRegistryResult {
  modules: HerdModule[]
  /** OTEL receiver router — mount at `/v1` (separate from module prefixes). */
  otelRouter: Router
  moduleGraph: LoadedHerdModuleGraph
  capabilities: HerdCapabilitySnapshot
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
    parsePositiveInteger(env.HERD_COMMAND_ROOM_POLL_INTERVAL_MS)
    ?? DEFAULT_COMMAND_ROOM_POLL_INTERVAL_MS
  const staleSessionTtlMinutes =
    parsePositiveInteger(env.HERD_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES)
    ?? DEFAULT_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES

  return {
    pollIntervalMs,
    maxPollAttempts: Math.max(1, Math.ceil((staleSessionTtlMinutes * 60_000) / pollIntervalMs)),
  }
}

export function resolveApprovalBridgeSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HERD_APPROVAL_BRIDGE_SIGNING_SECRET?.trim()
  if (configured) {
    return configured
  }

  const dataRoot = env.HERD_DATA_DIR?.trim()
    ? path.resolve(env.HERD_DATA_DIR.trim())
    : path.join(homedir(), '.herd')
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
  const moduleGraph = loadHerdModules()
  const capabilities = createHerdCapabilityContainer<HerdRuntimeCapabilities>()
  const runtime = createHerdModuleRuntimeRegistrations({
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
