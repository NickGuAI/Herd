import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchChannelReply } from '../../commanders/channel-dispatchers'
import { setOutboundSpeechSynthesizerForTests } from '../../../server/voice/tts'
import { registerChannelAdapter, resetChannelAdaptersForTests } from '../registry'
import {
  COMMANDER_ID,
  createChannelConversation,
  createMockAdapter,
  createTempChannelStores,
} from './helpers'

afterEach(() => {
  resetChannelAdaptersForTests()
  setOutboundSpeechSynthesizerForTests({ synthesize: null })
})

describe('voice TTS fallback', () => {
  it('falls back to text-only payload when synthesis fails', async () => {
    const stores = await createTempChannelStores()
    try {
      setOutboundSpeechSynthesizerForTests({
        synthesize: vi.fn(async () => {
          throw new Error('tts failed')
        }),
      })
      const adapter = createMockAdapter('whatsapp', true)
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore, {
        voiceConfig: { tts: { enabled: true } },
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
        message: 'text survives',
        surfaceBindingStore: stores.surfaceBindingStore,
        logger: { warn: vi.fn() },
      })

      expect(adapter.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { text: 'text survives' },
      )
    } finally {
      await stores.cleanup()
    }
  })
})
