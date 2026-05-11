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

describe('resolveInboundChannelMessage', () => {
  it('returns an existing surface binding and conversation by surface key', async () => {
    const stores = await createTempChannelStores()
    try {
      const conversation = await createChannelConversation(stores.conversationStore)
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

      const result = await resolveInboundChannelMessage(
        {
          event: makeInboundEvent(),
          channelMeta: makeChannelMeta(),
          lastRoute: makeLastRoute(),
        },
        stores,
      )

      expect(result).toMatchObject({
        ok: true,
        created: false,
        conversation: { id: conversation.id },
        binding: { surfaceKey: 'whatsapp:acct-1:peer-1' },
      })
    } finally {
      await stores.cleanup()
    }
  })

  it('drops an existing surface binding when the account binding is disabled', async () => {
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
        enabled: false,
        config: { dmPolicy: 'open' },
      })

      const result = await resolveInboundChannelMessage(
        {
          event: makeInboundEvent(),
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(),
          lastRoute: makeLastRoute(),
        },
        stores,
      )

      expect(result).toEqual({ ok: false, dropped: true, reason: 'missing-account-binding' })
    } finally {
      await stores.cleanup()
    }
  })

  it('rechecks current account policy before reusing an existing surface binding', async () => {
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
        config: { dmPolicy: 'allowlist', dmAllowlist: ['someone-else'] },
      })

      const result = await resolveInboundChannelMessage(
        {
          event: makeInboundEvent(),
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(),
          lastRoute: makeLastRoute(),
        },
        stores,
      )

      expect(result).toEqual({ ok: false, dropped: true, reason: 'policy-denied' })
    } finally {
      await stores.cleanup()
    }
  })

  it('silently drops allowlist-denied first inbound messages', async () => {
    const stores = await createTempChannelStores()
    try {
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { dmPolicy: 'allowlist', dmAllowlist: ['someone-else'] },
      })

      const result = await resolveInboundChannelMessage(
        {
          event: makeInboundEvent(),
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(),
          lastRoute: makeLastRoute(),
        },
        stores,
      )

      expect(result).toEqual({ ok: false, dropped: true, reason: 'policy-denied' })
      await expect(stores.conversationStore.listAll()).resolves.toEqual([])
      await expect(stores.surfaceBindingStore.list()).resolves.toEqual([])
    } finally {
      await stores.cleanup()
    }
  })

  it('atomically creates a surface binding and conversation when policy allows', async () => {
    const stores = await createTempChannelStores()
    try {
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { dmPolicy: 'allowlist', dmAllowlist: ['peer-1'] },
      })

      const result = await resolveInboundChannelMessage(
        {
          event: makeInboundEvent(),
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(),
          lastRoute: makeLastRoute(),
        },
        stores,
      )

      expect(result).toMatchObject({
        ok: true,
        created: true,
        binding: {
          commanderId: COMMANDER_ID,
          provider: 'whatsapp',
          accountId: 'acct-1',
          peerId: 'peer-1',
          surfaceKey: 'whatsapp:acct-1:peer-1',
        },
      })
      await expect(stores.conversationStore.listAll()).resolves.toHaveLength(1)
      await expect(stores.surfaceBindingStore.list()).resolves.toHaveLength(1)
    } finally {
      await stores.cleanup()
    }
  })
})
