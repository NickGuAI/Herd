import { afterEach, describe, expect, it } from 'vitest'
import { dispatchChannelReply } from '../../commanders/channel-dispatchers'
import {
  ChannelAdapterAlreadyRegisteredError,
  getChannelAdapter,
  registerChannelAdapter,
  resetChannelAdaptersForTests,
} from '../registry'
import {
  COMMANDER_ID,
  createChannelConversation,
  createMockAdapter,
  createTempChannelStores,
} from './helpers'

afterEach(() => {
  resetChannelAdaptersForTests()
})

describe('channel adapter registry', () => {
  it('registers, looks up, and dispatches by conversation surface binding', async () => {
    const stores = await createTempChannelStores()
    try {
      const adapter = createMockAdapter('whatsapp')
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore)
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
        message: 'assistant reply',
        surfaceBindingStore: stores.surfaceBindingStore,
      })

      expect(getChannelAdapter('whatsapp')).toBe(adapter)
      expect(adapter.send).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'whatsapp', accountId: 'acct-1' }),
        expect.objectContaining({ id: conversation.id, surface: 'whatsapp' }),
        { text: 'assistant reply' },
      )
    } finally {
      await stores.cleanup()
    }
  })

  it('rejects duplicate provider registration with a typed error', () => {
    registerChannelAdapter(createMockAdapter('whatsapp'))

    expect(() => registerChannelAdapter(createMockAdapter('whatsapp')))
      .toThrow(ChannelAdapterAlreadyRegisteredError)
  })

  it('returns null for unknown providers', () => {
    expect(getChannelAdapter('matrix')).toBeNull()
  })
})
