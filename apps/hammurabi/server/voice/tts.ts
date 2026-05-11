import {
  OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID,
  type ProviderSecretsStoreLike,
} from '../api-keys/provider-secrets-store.js'
import type { VoiceConfig } from '../../modules/commanders/voice-config.js'

export class SynthesisError extends Error {
  readonly cause?: unknown

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'SynthesisError'
    this.cause = options.cause
  }
}

interface SpeechSynthesizerOptions {
  providerSecretsStore: ProviderSecretsStoreLike
  fetchImpl?: typeof fetch
}

let apiKeyProvider: (() => Promise<string | null>) | null = null
let speechFetch: typeof fetch = fetch

export function initializeOutboundSpeechSynthesizer(options: SpeechSynthesizerOptions): void {
  apiKeyProvider = () => options.providerSecretsStore.getSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)
  speechFetch = options.fetchImpl ?? fetch
}

export function setOutboundSpeechSynthesizerForTests(options: {
  synthesize: ((text: string, voiceConfig: VoiceConfig) => Promise<Buffer>) | null
}): void {
  if (!options.synthesize) {
    apiKeyProvider = null
    speechFetch = fetch
    testSynthesizer = null
    return
  }
  testSynthesizer = options.synthesize
}

let testSynthesizer: ((text: string, voiceConfig: VoiceConfig) => Promise<Buffer>) | null = null

export async function synthesizeOutboundAudio(
  text: string,
  voiceConfig: VoiceConfig,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const normalizedText = text.trim()
  if (!normalizedText) {
    throw new SynthesisError('Cannot synthesize empty text')
  }
  if (testSynthesizer) {
    return {
      buffer: await testSynthesizer(normalizedText, voiceConfig),
      mimeType: 'audio/opus',
    }
  }
  if (!apiKeyProvider) {
    throw new SynthesisError('Outbound speech synthesizer is not initialized')
  }

  const apiKey = await apiKeyProvider()
  if (!apiKey) {
    throw new SynthesisError('OpenAI speech synthesis key is not configured')
  }

  try {
    const response = await speechFetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: voiceConfig.tts.voice || 'alloy',
        input: normalizedText,
        response_format: 'opus',
      }),
    })
    if (!response.ok) {
      const details = await response.text().catch(() => '')
      throw new Error(`OpenAI speech synthesis failed (${response.status}): ${details || response.statusText}`)
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: 'audio/opus',
    }
  } catch (error) {
    if (error instanceof SynthesisError) {
      throw error
    }
    throw new SynthesisError(
      error instanceof Error ? error.message : 'Speech synthesis failed',
      { cause: error },
    )
  }
}
