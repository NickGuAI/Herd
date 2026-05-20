import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchChannelReply } from '../../commanders/channel-dispatchers'
import type { ActionPolicyGate } from '../../policies/action-policy-gate'
import { registerChannelAdapter, resetChannelAdaptersForTests } from '../registry'
import {
  COMMANDER_ID,
  createChannelConversation,
  createMockAdapter,
  createTempChannelStores,
} from './helpers'

afterEach(() => {
  resetChannelAdaptersForTests()
})

describe('channel outbound dispatch', () => {
  it('sends assistant text through the adapter for a whatsapp conversation', async () => {
    const stores = await createTempChannelStores()
    try {
      const adapter = createMockAdapter('whatsapp')
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore, {
        agentType: 'codex',
      })
      await stores.surfaceBindingStore.upsertAtomic({
        provider: 'whatsapp',
        accountId: 'acct-1',
        peerId: 'peer-1',
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: conversation.id,
        enabled: true,
        config: {},
      })

      await dispatchChannelReply({
        conversation,
        message: 'codex assistant text',
        surfaceBindingStore: stores.surfaceBindingStore,
      })

      expect(adapter.send).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'whatsapp' }),
        expect.objectContaining({ agentType: 'codex' }),
        { text: 'codex assistant text' },
      )
    } finally {
      await stores.cleanup()
    }
  })

  it('gates outbound email replies through the send-email action policy', async () => {
    const stores = await createTempChannelStores()
    try {
      const adapter = createMockAdapter('email')
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore, {
        surface: 'email',
        channelMeta: {
          provider: 'email',
          chatType: 'direct',
          accountId: 'assistant@example.com',
          peerId: 'nick@example.com',
          sessionKey: 'email:assistant@example.com:nick@example.com:<thread-1>',
          displayName: 'Nick',
          subject: 'Need help',
          threadId: '<thread-1>',
        },
        lastRoute: {
          channel: 'email',
          to: '"Nick" <nick@example.com>',
          accountId: 'assistant@example.com',
          threadId: '<thread-1>',
        },
      })
      await stores.surfaceBindingStore.upsertAtomic({
        provider: 'email',
        accountId: 'assistant@example.com',
        peerId: 'nick@example.com',
        threadId: '<thread-1>',
        surfaceKey: 'email:assistant@example.com:nick@example.com:<thread-1>',
        commanderId: COMMANDER_ID,
        conversationId: conversation.id,
        enabled: true,
        config: {},
      })
      const actionPolicyGate = {
        enforceAndWait: vi.fn(async () => ({
          actionId: 'send-email',
          actionLabel: 'Send Email',
          decision: 'allow' as const,
          policyDecision: 'auto' as const,
          sessionContext: null,
        })),
      } as unknown as ActionPolicyGate

      await dispatchChannelReply({
        conversation,
        message: 'email reply',
        surfaceBindingStore: stores.surfaceBindingStore,
        actionPolicyGate,
      })

      expect(actionPolicyGate.enforceAndWait).toHaveBeenCalledWith({
        source: 'channel-reply',
        toolName: 'mcp__gmail__send',
        toolInput: {
          to: '"Nick" <nick@example.com>',
          subject: 'Need help',
          body: 'email reply',
        },
        fallbackSessionName: conversation.id,
      })
      expect(adapter.send).toHaveBeenCalledTimes(1)
    } finally {
      await stores.cleanup()
    }
  })

  it('does not send outbound email when the send-email action policy denies it', async () => {
    const stores = await createTempChannelStores()
    try {
      const adapter = createMockAdapter('email')
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore, {
        surface: 'email',
        channelMeta: {
          provider: 'email',
          chatType: 'direct',
          accountId: 'assistant@example.com',
          peerId: 'nick@example.com',
          sessionKey: 'email:assistant@example.com:nick@example.com:<thread-1>',
          displayName: 'Nick',
          subject: 'Need help',
        },
        lastRoute: {
          channel: 'email',
          to: 'nick@example.com',
          accountId: 'assistant@example.com',
        },
      })
      await stores.surfaceBindingStore.upsertAtomic({
        provider: 'email',
        accountId: 'assistant@example.com',
        peerId: 'nick@example.com',
        surfaceKey: 'email:assistant@example.com:nick@example.com:<thread-1>',
        commanderId: COMMANDER_ID,
        conversationId: conversation.id,
        enabled: true,
        config: {},
      })
      const actionPolicyGate = {
        enforceAndWait: vi.fn(async () => ({
          actionId: 'send-email',
          actionLabel: 'Send Email',
          decision: 'deny' as const,
          policyDecision: 'block' as const,
          reason: 'recipient blocked',
          sessionContext: null,
        })),
      } as unknown as ActionPolicyGate

      await expect(dispatchChannelReply({
        conversation,
        message: 'blocked email reply',
        surfaceBindingStore: stores.surfaceBindingStore,
        actionPolicyGate,
      })).rejects.toThrow('recipient blocked')

      expect(adapter.send).not.toHaveBeenCalled()
    } finally {
      await stores.cleanup()
    }
  })
})
