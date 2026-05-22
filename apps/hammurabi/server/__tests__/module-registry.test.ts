import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../api-keys/store.js'
import type { HammurabiModule } from '../module-runtime.js'
import { createModules, resolveCommandRoomMonitorOptions } from '../module-registry.js'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []
const previousEnv = {
  HAMMURABI_DATA_DIR: process.env.HAMMURABI_DATA_DIR,
  COMMANDER_DATA_DIR: process.env.COMMANDER_DATA_DIR,
}

function restoreEnvVar(key: 'HAMMURABI_DATA_DIR' | 'COMMANDER_DATA_DIR', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-03-18T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'commanders:read', 'org:write'],
    },
    'commanders-key': {
      id: 'commanders-key-id',
      name: 'Commanders Key',
      keyHash: 'hash',
      prefix: 'hmrb_cmd',
      createdBy: 'test',
      createdAt: '2026-03-18T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['commanders:read'],
    },
  } satisfies Record<string, ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }

      return { ok: true as const, record }
    },
  }
}

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function defaultModuleFilter(module: HammurabiModule): boolean {
  return module.name === 'operators' || module.name === 'org' || module.name === 'module-graph'
}

async function startRegistryServer(
  moduleFilter: (module: HammurabiModule) => boolean = defaultModuleFilter,
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const { modules } = createModules({
    apiKeyStore: createTestApiKeyStore(),
    initializeAgentSessionRuntimes: false,
    initializeAutomationScheduler: false,
    initializeChannelRuntimes: false,
    maxAgentSessions: 1,
  })
  for (const module of modules) {
    if (moduleFilter(module)) {
      app.use(module.routePrefix, module.router)
    }
  }

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  }
}

afterEach(async () => {
  restoreEnvVar('HAMMURABI_DATA_DIR', previousEnv.HAMMURABI_DATA_DIR)
  restoreEnvVar('COMMANDER_DATA_DIR', previousEnv.COMMANDER_DATA_DIR)
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('resolveCommandRoomMonitorOptions', () => {
  it('defaults command-room monitoring to a 30 minute stale-session window', () => {
    expect(resolveCommandRoomMonitorOptions({})).toEqual({
      pollIntervalMs: 5_000,
      maxPollAttempts: 360,
    })
  })

  it('derives max poll attempts from env overrides and ignores invalid values', () => {
    expect(resolveCommandRoomMonitorOptions({
      HAMMURABI_COMMAND_ROOM_POLL_INTERVAL_MS: '2000',
      HAMMURABI_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES: '45',
    })).toEqual({
      pollIntervalMs: 2_000,
      maxPollAttempts: 1_350,
    })

    expect(resolveCommandRoomMonitorOptions({
      HAMMURABI_COMMAND_ROOM_POLL_INTERVAL_MS: '0',
      HAMMURABI_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES: '-1',
    })).toEqual({
      pollIntervalMs: 5_000,
      maxPollAttempts: 360,
    })
  })
})

describe('createModules', () => {
  it('exposes declared runtime capabilities and the loader-backed module graph', () => {
    const { capabilities, moduleGraph, modules } = createModules({
      apiKeyStore: createTestApiKeyStore(),
      initializeAgentSessionRuntimes: false,
      initializeAutomationScheduler: false,
      initializeChannelRuntimes: false,
      maxAgentSessions: 1,
    })

    expect(capabilities.providers.get('auth.api-keys')).toBe('api-keys')
    expect(capabilities.providers.get('agents.sessions-interface')).toBe('agents')
    expect(capabilities.providers.get('policies.action-gate')).toBe('policies')
    expect(capabilities.providers.get('automations.scheduler')).toBe('automations')
    expect(capabilities.consumers.get('agents.sessions-interface')).toContain('commanders')
    expect(moduleGraph.manifestById.get('module-graph')?.server.routes[0]?.mount).toBe('/api/modules')
    expect(modules.some((module) => module.name === 'module-graph')).toBe(true)

    const modulesByName = new Map(modules.map((module) => [module.name, module]))
    expect(modulesByName.get('automations')?.routePrefix).toBe(
      moduleGraph.mountPlan.routes.find((route) => route.id === 'automations.api')?.mount,
    )
    expect(modulesByName.get('module-graph')?.routePrefix).toBe(
      moduleGraph.mountPlan.routes.find((route) => route.id === 'module-graph.api')?.mount,
    )
    expect(modulesByName.has('sentinels')).toBe(false)
  })

  it('serves graph metadata without exposing provider secrets or storage roots', async () => {
    const server = await startRegistryServer()
    try {
      const response = await fetch(`${server.baseUrl}/api/modules`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(200)
      const body = await response.json() as {
        modules: Array<{
          id: string
          ui: { routes: Array<{ id: string; metadata?: Record<string, unknown> }> }
        }>
        routes: Array<{ id: string; mount: string; methods: string[]; parserIds: string[] }>
        storage: Array<{ keys: string[]; roots?: string[]; files?: string[] }>
        providers: Array<{ id: string; label: string; modelIds: string[]; machineAuth?: { cliBinaryName: string } }>
      }
      expect(body.routes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'module-graph.api', mount: '/api/modules' }),
        expect.objectContaining({ id: 'api-keys.api', mount: '/api/auth' }),
      ]))
      expect(body.providers.length).toBeGreaterThan(0)
      expect(body.providers[0]).not.toHaveProperty('preparePtyEnv')
      expect(body.storage.some((entry) => 'roots' in entry || 'files' in entry)).toBe(false)
      expect(
        body.routes.filter((route) => route.id === 'workspace.api'),
      ).toEqual([
        expect.objectContaining({ mount: '/api/workspace', methods: ['GET', 'POST', 'PUT'], parserIds: [] }),
      ])
      const commandRoomRoute = body.modules
        .find((module) => module.id === 'command-room')
        ?.ui.routes.find((route) => route.id === 'command-room.ui')
      expect(commandRoomRoute?.metadata).toMatchObject({
        launch: {
          path: '/command-room',
          commanderParam: 'commander',
          conversationParam: 'conversation',
        },
        globalCommander: {
          commanderValue: 'global',
          panelParam: 'panel',
          defaultPanel: 'automation',
        },
      })
      expect(JSON.stringify(body)).not.toMatch(/keyHash|authEnvKeys|preparePtyEnv/i)
    } finally {
      await server.close()
    }
  })

  it('serves bootstrap graph metadata to valid API keys without agent scope', async () => {
    const server = await startRegistryServer()
    try {
      const response = await fetch(`${server.baseUrl}/api/modules`, {
        headers: {
          'x-hammurabi-api-key': 'commanders-key',
        },
      })

      expect(response.status).toBe(200)
      const body = await response.json() as {
        routes: Array<{ id: string; mount: string }>
      }
      expect(body.routes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'module-graph.api', mount: '/api/modules' }),
      ]))
    } finally {
      await server.close()
    }
  })

  it('mounts canonical agents and providers API routes from the manifest-backed registry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-module-registry-agents-'))
    tempDirs.push(dir)
    const dataDir = join(dir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir
    process.env.COMMANDER_DATA_DIR = join(dataDir, 'commander')

    const server = await startRegistryServer(
      (module) => module.name === 'agents' || module.name === 'providers',
    )
    try {
      for (const path of ['/api/agents/sessions', '/api/agents/machines', '/api/agents/world', '/api/providers']) {
        const response = await fetch(`${server.baseUrl}${path}`)
        expect(response.status, path).not.toBe(404)
        expect(response.headers.get('content-type') ?? '', path).toContain('application/json')
        await expect(response.json(), path).resolves.toHaveProperty('error')
      }

      for (const path of ['/api/sessions', '/api/machines', '/api/world']) {
        const response = await fetch(`${server.baseUrl}${path}`)
        expect(response.status, path).toBe(404)
      }
    } finally {
      await server.close()
    }
  })

  it('shares founder setup writes with the operators route after an initial missing-founder read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-module-registry-founder-'))
    tempDirs.push(dir)
    const dataDir = join(dir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir
    process.env.COMMANDER_DATA_DIR = join(dataDir, 'commander')

    const server = await startRegistryServer()
    try {
      const initialResponse = await fetch(`${server.baseUrl}/api/operators/founder`, {
        headers: API_KEY_HEADERS,
      })
      expect(initialResponse.status).toBe(404)

      const setupResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Issue 1415 Crosscheck Org',
          founder: {
            displayName: 'Crosscheck Founder',
            email: 'crosscheck@example.com',
          },
        }),
      })
      expect(setupResponse.status).toBe(201)

      const founderResponse = await fetch(`${server.baseUrl}/api/operators/founder`, {
        headers: API_KEY_HEADERS,
      })
      expect(founderResponse.status).toBe(200)
      await expect(founderResponse.json()).resolves.toMatchObject({
        displayName: 'Crosscheck Founder',
        email: 'crosscheck@example.com',
      })
    } finally {
      await server.close()
    }
  })
})
