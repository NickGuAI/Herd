import { afterEach, describe, expect, it } from 'vitest'
import { dispatchChannelReply } from '../../commanders/channel-dispatchers'
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
})
