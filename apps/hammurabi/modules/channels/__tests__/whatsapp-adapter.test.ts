import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../commanders/conversation-store'
import { CommanderChannelBindingStore } from '../store'
import type {
  ChannelInboundEvent,
  ChannelOutboundPayload,
  CommanderChannelBinding,
} from '../types'
import { WhatsAppChannelAdapter } from '../whatsapp/adapter'
import type { WhatsAppChannelConfig } from '../whatsapp/config'
import type {
  WhatsAppPairingSession,
  WhatsAppRuntimeStatus,
  WhatsAppTransport,
  WhatsAppTransportHandlers,
  WhatsAppTransportRuntime,
} from '../whatsapp/transport'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const OTHER_COMMANDER_ID = '33333333-3333-4333-8333-333333333333'
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-whatsapp-adapter-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

class FakeWhatsAppRuntime implements WhatsAppTransportRuntime {
  readonly accountId: string
  readonly send = vi.fn(async () => undefined)
  readonly stop = vi.fn(async () => undefined)
  private state: WhatsAppRuntimeStatus

  constructor(accountId: string, state: WhatsAppRuntimeStatus['state'] = 'connected') {
    this.accountId = accountId
    this.state = {
      provider: 'whatsapp',
      accountId,
      transport: 'baileys',
      state,
      connected: state === 'connected',
    }
  }

  status(): WhatsAppRuntimeStatus {
    return { ...this.state }
  }

  setStatus(state: Partial<WhatsAppRuntimeStatus>): void {
    this.state = {
      ...this.state,
      ...state,
    }
  }
}

class FakeWhatsAppTransport implements WhatsAppTransport {
  readonly kind = 'baileys'
  readonly runtimeByAccount = new Map<string, FakeWhatsAppRuntime>()
  handlersByAccount = new Map<string, WhatsAppTransportHandlers>()

  async start(input: {
    accountId: string
    config: WhatsAppChannelConfig
    handlers: WhatsAppTransportHandlers
  }): Promise<WhatsAppTransportRuntime> {
    const runtime = new FakeWhatsAppRuntime(input.accountId)
    this.runtimeByAccount.set(input.accountId, runtime)
    this.handlersByAccount.set(input.accountId, input.handlers)
    return runtime
  }

  async beginPairing(input: {
    challengeId: string
    accountId: string
    config: WhatsAppChannelConfig
    handlers: WhatsAppTransportHandlers
  }): Promise<WhatsAppPairingSession> {
    const runtime = new FakeWhatsAppRuntime(input.accountId, 'connected')
    this.runtimeByAccount.set(input.accountId, runtime)
    this.handlersByAccount.set(input.accountId, input.handlers)
    return {
      challengeId: input.challengeId,
      accountId: input.accountId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      runtime,
      status: runtime.status(),
      qrCode: 'qr-code',
      qrDataUrl: 'data:image/png;base64,qr',
    }
  }
}

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = '2026-05-17T00:00:00.000Z'
  return {
    id: 'conversation-1',
    commanderId: COMMANDER_ID,
    surface: 'whatsapp',
    lastRoute: {
      channel: 'whatsapp',
      to: '15551234567@s.whatsapp.net',
      accountId: 'pm-ai',
    },
    name: 'WhatsApp thread',
    status: 'active',
    currentTask: null,
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    creationSource: 'channel',
    createdByKind: 'channel',
    createdAt: now,
    lastMessageAt: now,
    ...overrides,
  }
}

describe('WhatsAppChannelAdapter', () => {
  it('creates a Baileys QR pairing challenge and completes it into a channel binding', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      transport,
    })

    const challenge = await adapter.beginPairing({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      config: {
        baileys: {
          browserName: 'Hervald Test',
          connectTimeoutMs: 5_000,
        },
      },
    })

    expect(challenge).toMatchObject({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      kind: 'qr',
      accountId: 'pm-ai',
      qrCode: 'qr-code',
      url: 'data:image/png;base64,qr',
      metadata: {
        transport: 'baileys',
      },
    })

    const binding = await adapter.completePairing(challenge, {
      provider: 'whatsapp',
      challengeId: challenge.id,
      displayName: 'PMI WhatsApp',
    })

    expect(binding).toMatchObject({
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      enabled: true,
    })
    expect(binding.config).toMatchObject({
      provider: 'whatsapp',
      transport: 'baileys',
      baileys: {
        browserName: 'Hervald Test',
      },
    })
    expect(transport.runtimeByAccount.get('pm-ai')?.stop).toHaveBeenCalled()
  })

  it('keeps pending pairing status and completion scoped to the owning commander', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      transport,
    })

    const challenge = await adapter.beginPairing({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
    })

    await expect(adapter.getPairingStatus({
      provider: 'whatsapp',
      commanderId: OTHER_COMMANDER_ID,
      id: challenge.id,
    })).rejects.toThrow(/does not belong to commander/)
    await expect(adapter.completePairing({
      provider: 'whatsapp',
      commanderId: OTHER_COMMANDER_ID,
      id: challenge.id,
    }, {
      provider: 'whatsapp',
      challengeId: challenge.id,
    })).rejects.toThrow(/does not belong to commander/)

    await adapter.completePairing(challenge, {
      provider: 'whatsapp',
      challengeId: challenge.id,
      displayName: 'PMI WhatsApp',
    })
    expect(transport.runtimeByAccount.get('pm-ai')?.stop).toHaveBeenCalled()
  })

  it('falls back to a generated WhatsApp account id when sanitizing removes every character', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      transport,
    })

    const challenge = await adapter.beginPairing({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      accountId: '!!!',
      displayName: 'PMI WhatsApp',
    })

    expect(challenge.accountId).toMatch(/^wa-[a-f0-9]{8}$/u)
    await adapter.completePairing(challenge, {
      provider: 'whatsapp',
      challengeId: challenge.id,
      displayName: 'PMI WhatsApp',
    })
  })

  it('returns live pending pairing status before completing the binding', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      transport,
    })

    const challenge = await adapter.beginPairing({
      provider: 'whatsapp',
      commanderId: COMMANDER_ID,
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
    })

    const runtime = transport.runtimeByAccount.get('pm-ai')
    runtime?.setStatus({
      state: 'pairing',
      connected: false,
      qrCode: 'qr-code-2',
      qrDataUrl: 'data:image/png;base64,qr-2',
      lastError: 'WhatsApp requested a pairing restart after scan (status 515); reconnecting.',
    })

    await expect(adapter.getPairingStatus({ provider: 'whatsapp', id: challenge.id })).resolves.toMatchObject({
      provider: 'whatsapp',
      id: challenge.id,
      accountId: 'pm-ai',
      kind: 'qr',
      state: 'pairing',
      connected: false,
      qrCode: 'qr-code-2',
      url: 'data:image/png;base64,qr-2',
      instructions: 'WhatsApp accepted the scan and is reconnecting. Keep WhatsApp open until it connects.',
      metadata: {
        transport: 'baileys',
        status: {
          state: 'pairing',
          lastError: 'WhatsApp requested a pairing restart after scan (status 515); reconnecting.',
        },
      },
    })

    runtime?.setStatus({
      state: 'connected',
      connected: true,
      lastError: undefined,
    })

    await expect(adapter.getPairingStatus({ provider: 'whatsapp', id: challenge.id })).resolves.toMatchObject({
      kind: 'connected',
      state: 'connected',
      connected: true,
    })
  })

  it('sends outbound messages through the active Baileys runtime using the conversation route', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      transport,
    })
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
        baileys: {
          sendTextWithVoiceNote: true,
        },
      },
    })

    const result = await adapter.send(
      {
        provider: 'whatsapp',
        accountId: 'pm-ai',
        commanderId: COMMANDER_ID,
      },
      createConversation(),
      { text: 'hello from commander' },
    )

    expect(result).toEqual({ success: true })
    const runtime = transport.runtimeByAccount.get(binding.accountId)
    expect(runtime?.send).toHaveBeenCalledWith(
      '15551234567@s.whatsapp.net',
      { text: 'hello from commander' },
      { sendTextWithVoiceNote: true },
    )
  })

  it('forwards inbound WhatsApp events to the backend channel ingestion endpoint', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      apiBaseUrl: 'http://127.0.0.1:20001',
      fetchImpl,
      transport,
    })
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
      },
    })

    await adapter.start(binding)
    const event: ChannelInboundEvent = {
      provider: 'whatsapp',
      accountId: 'pm-ai',
      chatType: 'direct',
      peerId: '15551234567@s.whatsapp.net',
      peerDisplayName: 'Nick',
      text: 'hello',
      audio: {
        buffer: Buffer.from('voice-note'),
        mimeType: 'audio/ogg',
        durationMs: 1000,
      },
      rawTimestamp: '2026-05-17T00:00:00.000Z',
      rawSourceId: 'message-1',
    }

    await transport.handlersByAccount.get(binding.accountId)?.onInbound(event)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:20001/api/commanders/channel-message')
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hammurabi-internal-token': 'internal-token',
      },
    })
    const body = JSON.parse(String(request?.body))
    expect(body).toMatchObject({
      provider: 'whatsapp',
      accountId: 'pm-ai',
      peerId: '15551234567@s.whatsapp.net',
      displayName: 'Nick',
      message: 'hello',
      audio: {
        buffer: Buffer.from('voice-note').toString('base64'),
        mimeType: 'audio/ogg',
        durationMs: 1000,
      },
    })
    expect(body.commanderId).toBeUndefined()
  })

  it('retries ambiguous inbound WhatsApp events with the active binding commander', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const transport = new FakeWhatsAppTransport()
    let fetchAttempt = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => (
      fetchAttempt++ === 0
        ? new Response(JSON.stringify({ error: 'specify commanderId' }), { status: 409 })
        : new Response('{}', { status: 200 })
    ))
    const adapter = new WhatsAppChannelAdapter({
      bindingStore,
      internalToken: 'internal-token',
      dataDir,
      apiBaseUrl: 'http://127.0.0.1:20001',
      fetchImpl,
      transport,
    })
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp',
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
      },
    })
    await bindingStore.create({
      commanderId: OTHER_COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'Shared WhatsApp',
      config: {
        provider: 'whatsapp',
        transport: 'baileys',
      },
    })

    await adapter.start(binding)
    const event: ChannelInboundEvent = {
      provider: 'whatsapp',
      accountId: 'pm-ai',
      chatType: 'direct',
      peerId: '15551234567@s.whatsapp.net',
      peerDisplayName: 'Nick',
      text: 'hello',
      rawTimestamp: '2026-05-17T00:00:00.000Z',
      rawSourceId: 'message-1',
    }

    await transport.handlersByAccount.get(binding.accountId)?.onInbound(event)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))
    expect(firstBody.commanderId).toBeUndefined()
    expect(secondBody).toMatchObject({
      provider: 'whatsapp',
      accountId: 'pm-ai',
      peerId: '15551234567@s.whatsapp.net',
      commanderId: COMMANDER_ID,
      message: 'hello',
    })
  })
})
