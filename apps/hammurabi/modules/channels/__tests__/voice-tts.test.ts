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

describe('voice TTS preflight', () => {
  it('runs when voice mode is enabled and the adapter supports voice notes', async () => {
    const stores = await createTempChannelStores()
    try {
      const synthesize = vi.fn(async () => Buffer.from('opus'))
      setOutboundSpeechSynthesizerForTests({ synthesize })
      const adapter = createMockAdapter('whatsapp', true)
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore, {
        voiceConfig: { tts: { enabled: true, voice: 'alloy' } },
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
        message: 'speak this',
        surfaceBindingStore: stores.surfaceBindingStore,
      })

      expect(synthesize).toHaveBeenCalledOnce()
      expect(adapter.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        {
          text: 'speak this',
          audio: { buffer: Buffer.from('opus'), mimeType: 'audio/opus' },
        },
      )
    } finally {
      await stores.cleanup()
    }
  })
})
