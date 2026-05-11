import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchChannelReply } from '../../commanders/channel-dispatchers'
import { applyInboundVoicePreflight } from '../../commanders/routes/register-channels'
import { setOutboundSpeechSynthesizerForTests } from '../../../server/voice/tts'
import { setInboundTranscriptionProviderForTests } from '../../../server/voice/stt'
import { registerChannelAdapter, resetChannelAdaptersForTests } from '../registry'
import {
  COMMANDER_ID,
  createChannelConversation,
  createMockAdapter,
  createTempChannelStores,
  makeInboundEvent,
} from './helpers'

afterEach(() => {
  resetChannelAdaptersForTests()
  setOutboundSpeechSynthesizerForTests({ synthesize: null })
  setInboundTranscriptionProviderForTests(null)
})

describe('non-voice channel adapters', () => {
  it('does not attach outbound audio even when voice mode is enabled', async () => {
    const stores = await createTempChannelStores()
    try {
      const synthesize = vi.fn(async () => Buffer.from('opus'))
      setOutboundSpeechSynthesizerForTests({ synthesize })
      const adapter = createMockAdapter('discord', false)
      registerChannelAdapter(adapter)
      const conversation = await createChannelConversation(stores.conversationStore, {
        surface: 'discord',
        voiceConfig: { tts: { enabled: true } },
      })
      await stores.surfaceBindingStore.upsertAtomic({
        provider: 'discord',
        accountId: 'guild-1',
        peerId: 'channel-1',
        surfaceKey: 'discord:guild-1:channel-1',
        commanderId: COMMANDER_ID,
        conversationId: conversation.id,
        enabled: true,
        config: {},
      })

      await dispatchChannelReply({
        conversation,
        message: 'plain text only',
        surfaceBindingStore: stores.surfaceBindingStore,
      })

      expect(synthesize).not.toHaveBeenCalled()
      expect(adapter.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { text: 'plain text only' },
      )
    } finally {
      await stores.cleanup()
    }
  })

  it('skips inbound STT for audio on adapters without voice notes', async () => {
    const stores = await createTempChannelStores()
    try {
      const transcribe = vi.fn(async () => ({
        title: 'voice',
        segments: [{ content: 'should not run' }],
        summary: 'should not run',
      }))
      setInboundTranscriptionProviderForTests({ provider: 'mock', transcribe })
      const conversation = await createChannelConversation(stores.conversationStore)

      const result = await applyInboundVoicePreflight({
        event: makeInboundEvent({
          text: undefined,
          audio: { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' },
        }),
        conversation,
        adapter: createMockAdapter('discord', false),
        message: '',
      })

      expect(result).toEqual({ ok: true, message: '', transcribed: false })
      expect(transcribe).not.toHaveBeenCalled()
    } finally {
      await stores.cleanup()
    }
  })
})
