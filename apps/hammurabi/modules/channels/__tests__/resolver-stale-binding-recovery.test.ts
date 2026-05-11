import { describe, expect, it } from 'vitest'
import { resolveInboundChannelMessage } from '../resolver'
import {
  COMMANDER_ID,
  createChannelConversation,
  createTempChannelStores,
  makeChannelMeta,
  makeInboundEvent,
  makeLastRoute,
} from './helpers'

describe('resolveInboundChannelMessage stale surface binding recovery', () => {
  it('deletes a dangling surface binding and creates a new conversation for the same surface', async () => {
    const stores = await createTempChannelStores()
    try {
      const event = makeInboundEvent()
      const conversation = await createChannelConversation(stores.conversationStore)
      const { binding: staleBinding } = await stores.surfaceBindingStore.upsertAtomic({
        provider: event.provider,
        accountId: event.accountId,
        peerId: event.peerId,
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: conversation.id,
        enabled: true,
        config: {},
      })
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: event.provider,
        accountId: event.accountId,
        displayName: 'WhatsApp',
        config: { dmPolicy: 'open' },
      })
      await stores.conversationStore.delete(conversation.id)

      const recovered = await resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )

      if (!recovered.ok) {
        throw new Error(`unexpected drop: ${recovered.reason}`)
      }
      expect(recovered.created).toBe(true)
      expect(recovered.binding.id).not.toBe(staleBinding.id)
      expect(recovered.conversation.id).not.toBe(conversation.id)
      await expect(stores.conversationStore.get(conversation.id)).resolves.toBeNull()
      await expect(stores.surfaceBindingStore.list()).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: staleBinding.id })]),
      )
      await expect(stores.surfaceBindingStore.getBySurfaceKey('whatsapp:acct-1:peer-1'))
        .resolves.toMatchObject({
          id: recovered.binding.id,
          conversationId: recovered.conversation.id,
        })

      const subsequent = await resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )

      expect(subsequent).toMatchObject({
        ok: true,
        created: false,
        binding: { id: recovered.binding.id },
        conversation: { id: recovered.conversation.id },
      })
    } finally {
      await stores.cleanup()
    }
  })
})
