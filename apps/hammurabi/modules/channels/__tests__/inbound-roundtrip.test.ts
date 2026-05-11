import { describe, expect, it, vi } from 'vitest'
import { resolveInboundChannelMessage } from '../resolver'
import {
  COMMANDER_ID,
  CONVERSATION_ID,
  createChannelConversation,
  createTempChannelStores,
  makeChannelMeta,
  makeInboundEvent,
  makeLastRoute,
} from './helpers'

describe('channel inbound roundtrip', () => {
  it('resolves a mock adapter event to the bound conversation and dispatches the text', async () => {
    const stores = await createTempChannelStores()
    try {
      await createChannelConversation(stores.conversationStore)
      await stores.surfaceBindingStore.upsertAtomic({
        provider: 'whatsapp',
        accountId: 'acct-1',
        peerId: 'peer-1',
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        enabled: true,
        config: {},
      })
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { dmPolicy: 'open' },
      })
      const event = makeInboundEvent({ text: 'adapter text' })
      const dispatchSend = vi.fn()

      const resolved = await resolveInboundChannelMessage(
        {
          event,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )
      if (!resolved.ok) {
        throw new Error(`unexpected drop: ${resolved.reason}`)
      }
      dispatchSend(resolved.conversation.id, event.text)

      expect(dispatchSend).toHaveBeenCalledWith(CONVERSATION_ID, 'adapter text')
    } finally {
      await stores.cleanup()
    }
  })
})
