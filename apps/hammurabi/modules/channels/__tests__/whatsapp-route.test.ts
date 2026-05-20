import express from 'express'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { CommanderSessionStore } from '../../commanders/store'
import {
  registerChannelAdapter,
  resetChannelAdaptersForTests,
} from '../registry'
import { createCommanderChannelsRouter } from '../route'
import { CommanderChannelBindingStore } from '../store'
import type {
  ChannelAdapter,
  ChannelInboundDecision,
  ChannelInboundEvent,
  ChannelPairingChallenge,
  ChannelRuntime,
  ChannelSendResult,
  CommanderChannelBinding,
} from '../types'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}
const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const tempDirs: string[] = []
const tempServers: RunningServer[] = []

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-whatsapp-route-'))
  tempDirs.push(dir)
  return dir
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
      scopes: ['commanders:read', 'commanders:write'],
    },
  } satisfies Record<string, import('../../../server/api-keys/store').ApiKeyRecord>

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

function createFakeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  const adapter: ChannelAdapter = {
    provider: 'whatsapp',
    capabilities: {
      voiceNotes: true,
      media: true,
      threading: false,
      typingIndicators: false,
      presence: false,
      reactions: false,
      markdownDialect: 'whatsapp',
    },
    start: async () => ({ provider: 'whatsapp', accountId: 'pm-ai' }),
    stop: async () => undefined,
    beginPairing: async (): Promise<ChannelPairingChallenge> => ({
      provider: 'whatsapp',
      kind: 'qr',
      id: 'challenge-1',
      accountId: 'pm-ai',
      qrCode: 'qr-code',
      url: 'data:image/png;base64,qr',
    }),
    completePairing: async (): Promise<CommanderChannelBinding> => ({
      id: 'binding-1',
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      enabled: true,
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }),
    send: async (): Promise<ChannelSendResult> => ({ success: true }),
    checkInboundAllowed: async (): Promise<ChannelInboundDecision> => ({ allowed: true }),
    ...overrides,
  }
  return adapter
}

async function startServer(options: {
  store: CommanderChannelBindingStore
  sessionStore?: Pick<CommanderSessionStore, 'get'>
  onBindingCreated?: (binding: CommanderChannelBinding) => Promise<void> | void
}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  app.use('/api/commanders', createCommanderChannelsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store: options.store,
    sessionStore: options.sessionStore ?? {
      get: async () => ({ id: COMMANDER_ID }) as Awaited<ReturnType<CommanderSessionStore['get']>>,
    },
    onBindingCreated: options.onBindingCreated,
  }))

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  const server = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
  tempServers.push(server)
  return server
}

afterEach(async () => {
  resetChannelAdaptersForTests()
  await Promise.all(tempServers.splice(0).map((server) => server.close()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('WhatsApp channel routes', () => {
  it('begins provider pairing through the registered WhatsApp adapter', async () => {
    const beginPairing = vi.fn<ChannelAdapter['beginPairing']>(async (input) => ({
      provider: 'whatsapp',
      kind: 'qr',
      id: 'challenge-1',
      accountId: input.accountId,
      qrCode: 'qr-code',
      url: 'data:image/png;base64,qr',
    }))
    registerChannelAdapter(createFakeAdapter({ beginPairing }))
    const dataDir = await createTempDir()
    const server = await startServer({
      store: new CommanderChannelBindingStore(join(dataDir, 'channels.json')),
    })

    const response = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/pairing`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'whatsapp',
        accountId: 'pm-ai',
        displayName: 'PMI WhatsApp',
        config: {
          transport: 'baileys',
        },
      }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      provider: 'whatsapp',
      id: 'challenge-1',
      accountId: 'pm-ai',
      qrCode: 'qr-code',
    })
    expect(beginPairing).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
    }))
  })

  it('rejects invalid WhatsApp descriptor policy before beginning pairing', async () => {
    const beginPairing = vi.fn<ChannelAdapter['beginPairing']>()
    registerChannelAdapter(createFakeAdapter({ beginPairing }))
    const dataDir = await createTempDir()
    const server = await startServer({
      store: new CommanderChannelBindingStore(join(dataDir, 'channels.json')),
    })

    const response = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/pairing`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'whatsapp',
        accountId: 'pm-ai',
        displayName: 'PMI WhatsApp',
        config: {
          transport: 'baileys',
          dmPolicy: 'friends-only',
        },
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'DM Policy must be one of allowlist, open, disabled',
    })
    expect(beginPairing).not.toHaveBeenCalled()
  })

  it('completes provider pairing and notifies the channel runtime hook', async () => {
    const binding: CommanderChannelBinding = {
      id: 'binding-1',
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      enabled: true,
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }
    const completePairing = vi.fn<ChannelAdapter['completePairing']>(async () => binding)
    const onBindingCreated = vi.fn()
    registerChannelAdapter(createFakeAdapter({ completePairing }))
    const dataDir = await createTempDir()
    const server = await startServer({
      store: new CommanderChannelBindingStore(join(dataDir, 'channels.json')),
      onBindingCreated,
    })

    const response = await fetch(
      `${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/pairing/challenge-1/complete`,
      {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'pm-ai',
          displayName: 'PMI WhatsApp',
        }),
      },
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject(binding)
    expect(completePairing).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'challenge-1', commanderId: COMMANDER_ID, accountId: 'pm-ai' }),
      expect.objectContaining({ challengeId: 'challenge-1', accountId: 'pm-ai' }),
    )
    expect(onBindingCreated).toHaveBeenCalledWith(binding)
  })

  it('returns pending provider pairing status through the registered WhatsApp adapter', async () => {
    const getPairingStatus = vi.fn<NonNullable<ChannelAdapter['getPairingStatus']>>(async (challenge) => ({
      provider: 'whatsapp',
      kind: 'qr',
      id: challenge.id,
      accountId: challenge.accountId,
      state: 'pairing',
      connected: false,
      qrCode: 'qr-code',
      url: 'data:image/png;base64,qr',
      instructions: 'Open WhatsApp, go to Linked Devices, and scan this QR code.',
    }))
    registerChannelAdapter(createFakeAdapter({ getPairingStatus }))
    const dataDir = await createTempDir()
    const server = await startServer({
      store: new CommanderChannelBindingStore(join(dataDir, 'channels.json')),
    })

    const response = await fetch(
      `${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/pairing/challenge-1/status?provider=whatsapp&accountId=pm-ai`,
      { headers: API_KEY_HEADERS },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      provider: 'whatsapp',
      kind: 'qr',
      id: 'challenge-1',
      accountId: 'pm-ai',
      state: 'pairing',
      connected: false,
      qrCode: 'qr-code',
      url: 'data:image/png;base64,qr',
      instructions: 'Open WhatsApp, go to Linked Devices, and scan this QR code.',
    })
    expect(getPairingStatus).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      id: 'challenge-1',
      accountId: 'pm-ai',
    }))
  })

  it('returns adapter status for an existing WhatsApp binding', async () => {
    const dataDir = await createTempDir()
    const store = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const binding = await store.create({
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
      },
    })
    const getStatus = vi.fn<NonNullable<ChannelAdapter['getStatus']>>(async () => ({
      provider: 'whatsapp',
      accountId: 'pm-ai',
      transport: 'baileys',
      state: 'connected',
      connected: true,
    }))
    registerChannelAdapter(createFakeAdapter({ getStatus }))
    const server = await startServer({ store })

    const response = await fetch(
      `${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/${binding.id}/status`,
      { headers: API_KEY_HEADERS },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      provider: 'whatsapp',
      accountId: 'pm-ai',
      transport: 'baileys',
      state: 'connected',
      connected: true,
    })
    expect(getStatus).toHaveBeenCalledWith(expect.objectContaining({
      id: binding.id,
      provider: 'whatsapp',
      accountId: 'pm-ai',
    }))
  })
})
