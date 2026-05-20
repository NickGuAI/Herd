import express from 'express'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { CommanderSecretsStore } from '../../commanders/secrets-store'
import type { CommanderSessionStore } from '../../commanders/store'
import { createCommanderChannelsRouter } from '../route'
import { CommanderChannelBindingStore } from '../store'
import { emailCredentialRef } from '../email/config'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []
const tempServers: Array<{ close: () => Promise<void> }> = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }
      const scopes = ['commanders:read', 'commanders:write']
      if ((options?.requiredScopes ?? []).some((scope) => !scopes.includes(scope))) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }
      return {
        ok: true as const,
        record: {
          id: 'test-key-id',
          name: 'Test Key',
          keyHash: 'hash',
          prefix: 'hmrb_test',
          createdBy: 'test',
          createdAt: '2026-05-17T00:00:00.000Z',
          lastUsedAt: null,
          scopes,
        },
      }
    },
  }
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-email-route-'))
  tempDirs.push(dir)
  return dir
}

async function startServer(dir: string) {
  const app = express()
  const store = new CommanderChannelBindingStore(join(dir, 'channels.json'))
  const secretsStore = new CommanderSecretsStore({
    dataDir: dir,
    keyFilePath: join(dir, 'master.key'),
  })
  app.use(express.json())
  app.use('/api/commanders', createCommanderChannelsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store,
    secretsStore,
    sessionStore: {
      get: async (id: string) => (id === COMMANDER_ID ? { id } : null),
    } as Pick<CommanderSessionStore, 'get'>,
  }))

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve server address')
  }

  const server = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    secretsStore,
    close: async () => {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve())
      })
    },
  }
  tempServers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(tempServers.splice(0).map((server) => server.close()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('email channel route', () => {
  it('creates email bindings through the generic channel API and stores credentials encrypted', async () => {
    const dir = await createTempDir()
    const server = await startServer(dir)

    const response = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'email',
        accountId: 'assistant@example.com',
        displayName: 'Assistant Email',
        enabled: true,
        config: {
          appPassword: 'super-secret-route-password',
          username: 'assistant@example.com',
          fromAddress: 'assistant@example.com',
          emailAlias: 'atlas',
          allowlist: ['nick@example.com'],
        },
      }),
    })

    expect(response.status).toBe(201)
    const created = await response.json() as {
      id: string
      config: Record<string, unknown>
    }
    expect(created.config).toMatchObject({
      provider: 'email',
      username: 'assistant@example.com',
      fromAddress: 'assistant@example.com',
      emailAlias: 'atlas',
      credentialConfigured: true,
      allowlist: ['nick@example.com'],
    })
    expect(created.config).not.toHaveProperty('appPassword')
    expect(created.config).not.toHaveProperty('password')
    expect(created.config).not.toHaveProperty('credential')

    const credentialRef = emailCredentialRef('assistant@example.com')
    await expect(server.secretsStore.getSecret(COMMANDER_ID, credentialRef))
      .resolves.toBe('super-secret-route-password')
    const encryptedFile = await readFile(join(dir, COMMANDER_ID, 'secrets.enc'), 'utf8')
    expect(encryptedFile).not.toContain('super-secret-route-password')

    const patchResponse = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/${created.id}`, {
      method: 'PATCH',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          allowlist: ['team@example.com'],
        },
      }),
    })
    expect(patchResponse.status).toBe(200)
    const patched = await patchResponse.json() as { config: Record<string, unknown> }
    expect(patched.config).toMatchObject({
      credentialRef,
      credentialConfigured: true,
      allowlist: ['team@example.com'],
      emailAlias: 'atlas',
    })
    await expect(server.secretsStore.getSecret(COMMANDER_ID, credentialRef))
      .resolves.toBe('super-secret-route-password')
  })

  it('does not rotate the existing encrypted credential on duplicate create', async () => {
    const dir = await createTempDir()
    const server = await startServer(dir)
    const body = {
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      enabled: true,
      config: {
        appPassword: 'initial-route-password',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        allowlist: ['nick@example.com'],
      },
    }

    const first = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    expect(first.status).toBe(201)

    const duplicate = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...body,
        config: {
          ...body.config,
          appPassword: 'rotated-route-password',
        },
      }),
    })

    expect(duplicate.status).toBe(409)
    await expect(server.secretsStore.getSecret(COMMANDER_ID, emailCredentialRef('assistant@example.com')))
      .resolves.toBe('initial-route-password')
  })

  it('rejects invalid email descriptor config before storing credentials', async () => {
    const dir = await createTempDir()
    const server = await startServer(dir)

    const missingPassword = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'email',
        accountId: 'assistant@example.com',
        displayName: 'Assistant Email',
        enabled: true,
        config: {
          username: 'assistant@example.com',
          fromAddress: 'assistant@example.com',
          allowlist: ['nick@example.com'],
        },
      }),
    })
    expect(missingPassword.status).toBe(400)
    await expect(missingPassword.json()).resolves.toEqual({
      error: 'App Password is required for an enabled email channel.',
    })

    const invalidAllowlist = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'email',
        accountId: 'assistant@example.com',
        displayName: 'Assistant Email',
        enabled: true,
        config: {
          appPassword: 'should-not-be-written',
          username: 'assistant@example.com',
          fromAddress: 'assistant@example.com',
          allowlist: 'nick@example.com',
        },
      }),
    })
    expect(invalidAllowlist.status).toBe(400)
    await expect(invalidAllowlist.json()).resolves.toEqual({
      error: 'Allowed Senders must be an array',
    })
    await expect(server.secretsStore.getSecret(COMMANDER_ID, emailCredentialRef('assistant@example.com')))
      .resolves.toBeNull()
  })

  it('does not persist a new credential when binding creation validation fails', async () => {
    const dir = await createTempDir()
    const server = await startServer(dir)

    const response = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'email',
        accountId: 'assistant@example.com',
        displayName: '',
        enabled: true,
        config: {
          appPassword: 'should-not-be-written',
          username: 'assistant@example.com',
          fromAddress: 'assistant@example.com',
          allowlist: ['nick@example.com'],
        },
      }),
    })

    expect(response.status).toBe(400)
    await expect(server.secretsStore.getSecret(COMMANDER_ID, emailCredentialRef('assistant@example.com')))
      .resolves.toBeNull()
  })
})
