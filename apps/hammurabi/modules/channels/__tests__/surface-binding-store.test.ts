import { describe, expect, it } from 'vitest'
import { ChannelSurfaceBindingStore } from '../surface-binding-store'
import { COMMANDER_ID, CONVERSATION_ID, createTempChannelStores } from './helpers'

describe('ChannelSurfaceBindingStore', () => {
  it('persists and reloads surface bindings', async () => {
    const stores = await createTempChannelStores()
    try {
      const created = await stores.surfaceBindingStore.upsertAtomic({
        provider: 'whatsapp',
        accountId: 'acct-1',
        peerId: 'peer-1',
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        enabled: true,
        config: { source: 'test' },
      })

      const reloaded = new ChannelSurfaceBindingStore(
        `${stores.dataRoot}/channels/surface-bindings.json`,
      )
      await expect(reloaded.getBySurfaceKey('whatsapp:acct-1:peer-1'))
        .resolves.toEqual(created.binding)
      await expect(reloaded.getByConversationId(CONVERSATION_ID))
        .resolves.toEqual(created.binding)
    } finally {
      await stores.cleanup()
    }
  })

  it('serializes concurrent upserts so one surface creates exactly one binding', async () => {
    const stores = await createTempChannelStores()
    try {
      const [left, right] = await Promise.all([
        stores.surfaceBindingStore.upsertAtomic({
          provider: 'whatsapp',
          accountId: 'acct-1',
          peerId: 'peer-1',
          surfaceKey: 'whatsapp:acct-1:peer-1',
          commanderId: COMMANDER_ID,
          conversationId: CONVERSATION_ID,
          enabled: true,
          config: { side: 'left' },
        }),
        stores.surfaceBindingStore.upsertAtomic({
          provider: 'whatsapp',
          accountId: 'acct-1',
          peerId: 'peer-1',
          surfaceKey: 'whatsapp:acct-1:peer-1',
          commanderId: COMMANDER_ID,
          conversationId: '33333333-3333-4333-8333-333333333333',
          enabled: true,
          config: { side: 'right' },
        }),
      ])

      expect([left.created, right.created].filter(Boolean)).toHaveLength(1)
      await expect(stores.surfaceBindingStore.list()).resolves.toHaveLength(1)
      expect((await stores.surfaceBindingStore.getBySurfaceKey('whatsapp:acct-1:peer-1'))?.id)
        .toBe(left.binding.id)
      expect(right.binding.id).toBe(left.binding.id)
    } finally {
      await stores.cleanup()
    }
  })

  it('does not treat disabled surface bindings as active upsert conflicts', async () => {
    const stores = await createTempChannelStores()
    try {
      const disabled = await stores.surfaceBindingStore.upsertAtomic({
        provider: 'whatsapp',
        accountId: 'acct-1',
        peerId: 'peer-1',
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        enabled: false,
        config: { disabled: true },
      })

      const enabled = await stores.surfaceBindingStore.upsertAtomic({
        provider: 'whatsapp',
        accountId: 'acct-1',
        peerId: 'peer-1',
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: '33333333-3333-4333-8333-333333333333',
        enabled: true,
        config: { enabled: true },
      })

      expect(disabled.created).toBe(true)
      expect(enabled.created).toBe(true)
      expect(enabled.binding.id).not.toBe(disabled.binding.id)
      await expect(stores.surfaceBindingStore.getBySurfaceKey('whatsapp:acct-1:peer-1'))
        .resolves.toEqual(enabled.binding)
      await expect(stores.surfaceBindingStore.list()).resolves.toHaveLength(2)
    } finally {
      await stores.cleanup()
    }
  })

  it('deletes by binding id', async () => {
    const stores = await createTempChannelStores()
    try {
      const { binding } = await stores.surfaceBindingStore.upsertAtomic({
        provider: 'whatsapp',
        accountId: 'acct-1',
        peerId: 'peer-1',
        surfaceKey: 'whatsapp:acct-1:peer-1',
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        enabled: true,
        config: {},
      })

      await expect(stores.surfaceBindingStore.deleteByBinding(binding.id)).resolves.toBe(true)
      await expect(stores.surfaceBindingStore.list()).resolves.toEqual([])
    } finally {
      await stores.cleanup()
    }
  })
})
