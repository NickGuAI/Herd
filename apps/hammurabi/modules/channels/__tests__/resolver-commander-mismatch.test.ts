import { describe, expect, it } from 'vitest'
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

const OTHER_COMMANDER_ID = '33333333-3333-4333-8333-333333333333'

describe('resolveInboundChannelMessage commander isolation', () => {
  it('rejects existing surface bindings owned by a different commander with 403', async () => {
    const stores = await createTempChannelStores()
    try {
      const event = makeInboundEvent()
      await createChannelConversation(stores.conversationStore, {
        commanderId: OTHER_COMMANDER_ID,
      })
      await stores.surfaceBindingStore.upsertAtomic({
        provider: event.provider,
        accountId: event.accountId,
        peerId: event.peerId,
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: OTHER_COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        enabled: true,
        config: {},
      })

      await expect(resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )).rejects.toMatchObject({
        name: 'CommanderMismatchError',
        statusCode: 403,
        requestedCommanderId: COMMANDER_ID,
        bindingCommanderId: OTHER_COMMANDER_ID,
        surfaceKey: 'whatsapp:acct-1:peer-1',
      })
    } finally {
      await stores.cleanup()
    }
  })
})
