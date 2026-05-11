import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { ConversationStore, type Conversation } from '../../commanders/conversation-store'
import { CommanderChannelBindingStore } from '../store'
import { ChannelSurfaceBindingStore } from '../surface-binding-store'
import type {
  ChannelAdapter,
  ChannelInboundEvent,
  ChannelOutboundPayload,
  ChannelRuntime,
} from '../types'

export const COMMANDER_ID = '11111111-1111-4111-8111-111111111111'
export const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'

export async function createTempChannelStores(): Promise<{
  dataRoot: string
  commanderDataDir: string
  conversationStore: ConversationStore
  accountBindingStore: CommanderChannelBindingStore
  surfaceBindingStore: ChannelSurfaceBindingStore
  cleanup: () => Promise<void>
}> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'hammurabi-channel-tests-'))
  const commanderDataDir = join(dataRoot, 'commander')
  return {
    dataRoot,
    commanderDataDir,
    conversationStore: new ConversationStore(commanderDataDir),
    accountBindingStore: new CommanderChannelBindingStore(join(dataRoot, 'channels.json')),
    surfaceBindingStore: new ChannelSurfaceBindingStore(join(dataRoot, 'channels', 'surface-bindings.json')),
    cleanup: () => rm(dataRoot, { recursive: true, force: true }),
  }
}

export function makeInboundEvent(overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent {
  return {
    provider: 'whatsapp',
    accountId: 'acct-1',
    chatType: 'direct',
    peerId: 'peer-1',
    text: 'hello from channel',
    rawTimestamp: '2026-05-10T00:00:00.000Z',
    rawSourceId: 'source-1',
    ...overrides,
  }
}

export function makeChannelMeta(event: ChannelInboundEvent = makeInboundEvent()) {
  return {
    provider: event.provider,
    chatType: event.chatType,
    accountId: event.accountId,
    peerId: event.peerId,
    ...(event.groupId ? { groupId: event.groupId } : {}),
    ...(event.threadId ? { threadId: event.threadId } : {}),
    sessionKey: `${event.provider}:${event.accountId}:${event.chatType}:${event.peerId}`,
    displayName: event.peerDisplayName ?? event.peerId,
  }
}

export function makeLastRoute(event: ChannelInboundEvent = makeInboundEvent()) {
  return {
    channel: event.provider,
    to: event.peerId,
    accountId: event.accountId,
    ...(event.threadId ? { threadId: event.threadId } : {}),
  }
}

export async function createChannelConversation(
  conversationStore: ConversationStore,
  overrides: Partial<Conversation> = {},
): Promise<Conversation> {
  const nowIso = '2026-05-10T00:00:00.000Z'
  const event = makeInboundEvent()
  return conversationStore.create({
    id: CONVERSATION_ID,
    commanderId: COMMANDER_ID,
    surface: event.provider,
    channelMeta: makeChannelMeta(event),
    lastRoute: makeLastRoute(event),
    status: 'idle',
    currentTask: null,
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    creationSource: 'channel',
    createdByKind: 'channel',
    createdById: event.provider,
    requestId: 'whatsapp:acct-1:peer-1',
    createdAt: nowIso,
    lastMessageAt: nowIso,
    ...overrides,
  })
}

export function createMockAdapter(provider = 'whatsapp', voiceNotes = false): ChannelAdapter {
  return {
    provider,
    capabilities: {
      voiceNotes,
      media: false,
      threading: false,
      typingIndicators: false,
      presence: false,
      reactions: false,
      markdownDialect: provider,
    },
    start: vi.fn(async () => ({ provider, accountId: 'acct-1' })),
    stop: vi.fn(async () => undefined),
    beginPairing: vi.fn(async () => ({ provider })),
    completePairing: vi.fn(async () => {
      throw new Error('not implemented')
    }),
    send: vi.fn(async (
      _runtime: ChannelRuntime,
      _conversation: Conversation,
      _payload: ChannelOutboundPayload,
    ) => ({ success: true as const })),
    checkInboundAllowed: vi.fn(async () => ({ allowed: true as const })),
  }
}
