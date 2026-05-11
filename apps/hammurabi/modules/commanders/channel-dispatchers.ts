import { getChannelAdapter } from '../channels/registry.js'
import {
  ChannelSurfaceBindingStore,
} from '../channels/surface-binding-store.js'
import type {
  ChannelOutboundPayload,
  ChannelSurfaceBinding,
} from '../channels/types.js'
import { synthesizeOutboundAudio } from '../../server/voice/tts.js'
import { resolveConversationVoiceConfig } from './voice-config.js'
import type { Conversation } from './conversation-store.js'

export interface DispatchChannelReplyInput {
  conversation: Conversation
  message: string
  surfaceBindingStore?: ChannelSurfaceBindingStore
  env?: NodeJS.ProcessEnv
  logger?: Pick<Console, 'warn'>
}

export interface DispatchChannelReplyResult {
  provider: string
  binding: ChannelSurfaceBinding
  payload: ChannelOutboundPayload
}

export async function dispatchChannelReply(
  input: DispatchChannelReplyInput,
): Promise<DispatchChannelReplyResult> {
  const surfaceBindingStore = input.surfaceBindingStore ?? new ChannelSurfaceBindingStore()
  const logger = input.logger ?? console
  const binding = await surfaceBindingStore.getByConversationId(input.conversation.id)
  if (!binding) {
    throw new Error(`No channel surface binding for conversation "${input.conversation.id}"`)
  }

  const adapter = getChannelAdapter(binding.provider)
  if (!adapter) {
    throw new Error(`No channel adapter registered for provider "${binding.provider}"`)
  }

  const payload: ChannelOutboundPayload = {
    text: input.message,
  }
  const voiceConfig = await resolveConversationVoiceConfig(input.conversation, input.env)
  if (voiceConfig.tts.enabled && adapter.capabilities.voiceNotes) {
    try {
      payload.audio = await synthesizeOutboundAudio(input.message, voiceConfig)
    } catch (error) {
      logger.warn(
        `[channels] TTS synthesis failed for conversation "${input.conversation.id}"; falling back to text-only payload:`,
        error,
      )
    }
  }

  const result = await adapter.send(
    {
      provider: binding.provider,
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      surfaceBinding: binding,
    },
    input.conversation,
    payload,
  )
  if (!result.success) {
    throw new Error(result.error || `Failed to dispatch ${binding.provider} channel reply`)
  }

  return {
    provider: binding.provider,
    binding,
    payload,
  }
}
