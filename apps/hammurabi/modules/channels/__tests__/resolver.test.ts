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

  it('allows trusted WhatsApp self-chat messages under the default allowlist policy', async () => {
    const stores = await createTempChannelStores()
    try {
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { dmPolicy: 'allowlist' },
      })
      const event = makeInboundEvent({
        peerId: '15551234567@s.whatsapp.net',
        metadata: {
          selfAuthored: true,
          selfChat: true,
        },
      })

      const result = await resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
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
          peerId: '15551234567@s.whatsapp.net',
        },
      })
    } finally {
      await stores.cleanup()
    }
  })

  it('does not allow trusted WhatsApp self-chat messages when DMs are disabled', async () => {
    const stores = await createTempChannelStores()
    try {
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { dmPolicy: 'disabled' },
      })
      const event = makeInboundEvent({
        peerId: '15551234567@s.whatsapp.net',
        metadata: {
          selfAuthored: true,
          selfChat: true,
        },
      })

      const result = await resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )

      expect(result).toEqual({ ok: false, dropped: true, reason: 'policy-denied' })
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

  it('accepts formatted phone numbers in WhatsApp direct-message allowlists', async () => {
    const stores = await createTempChannelStores()
    try {
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { dmPolicy: 'allowlist', dmAllowlist: ['(555) 123-4567'] },
      })
      const event = makeInboundEvent({
        peerId: '15551234567@s.whatsapp.net',
      })

      const result = await resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )

      expect(result).toMatchObject({
        ok: true,
        created: true,
        binding: {
          peerId: '15551234567@s.whatsapp.net',
        },
      })
    } finally {
      await stores.cleanup()
    }
  })

  it('does not phone-normalize WhatsApp group allowlists', async () => {
    const stores = await createTempChannelStores()
    try {
      await stores.accountBindingStore.create({
        commanderId: COMMANDER_ID,
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
        config: { groupPolicy: 'allowlist', groupAllowlist: ['120363012345'] },
      })
      const event = makeInboundEvent({
        chatType: 'group',
        peerId: '120363012345@g.us',
        groupId: '120363012345@g.us',
      })

      const result = await resolveInboundChannelMessage(
        {
          event,
          commanderId: COMMANDER_ID,
          channelMeta: makeChannelMeta(event),
          lastRoute: makeLastRoute(event),
        },
        stores,
      )

      expect(result).toEqual({ ok: false, dropped: true, reason: 'policy-denied' })
    } finally {
      await stores.cleanup()
    }
  })
})
