import { getChannelAdapter } from '../channels/registry.js'
import {
  ChannelSurfaceBindingStore,
} from '../channels/surface-binding-store.js'
import type {
  ChannelAdapter,
  ChannelOutboundMessageRef,
  ChannelOutboundPayload,
  ChannelRuntime,
  ChannelSurfaceBinding,
} from '../channels/types.js'
import type { ActionPolicyGate } from '../policies/action-policy-gate.js'
import { synthesizeOutboundAudio } from '../../server/voice/tts.js'
import { resolveConversationVoiceConfig } from './voice-config.js'
import type { Conversation } from './conversation-store.js'

export interface DispatchChannelReplyInput {
  conversation: Conversation
  message: string
  surfaceBindingStore?: ChannelSurfaceBindingStore
  actionPolicyGate?: ActionPolicyGate
  env?: NodeJS.ProcessEnv
  logger?: Pick<Console, 'warn'>
}

export interface DispatchChannelReplyResult {
  provider: string
  binding: ChannelSurfaceBinding
  payload: ChannelOutboundPayload
}

export interface ChannelReplyStreamDispatch {
  update(message: string): Promise<void>
  finalize(message: string): Promise<DispatchChannelReplyResult>
  fail(message: string): Promise<boolean>
}

interface PreparedChannelReplyDispatch {
  provider: string
  binding: ChannelSurfaceBinding
  adapter: ChannelAdapter
  runtime: ChannelRuntime
  payload: ChannelOutboundPayload
  audioEligible: boolean
}

const DEFAULT_CHANNEL_REPLY_EDIT_THROTTLE_MS = 1200

async function prepareChannelReplyDispatch(
  input: DispatchChannelReplyInput,
  options: {
    includeAudio?: boolean
    enforceActionPolicy?: boolean
  } = {},
): Promise<PreparedChannelReplyDispatch> {
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
  const audioEligible = voiceConfig.tts.enabled && adapter.capabilities.voiceNotes
  if (audioEligible && options.includeAudio !== false) {
    try {
      payload.audio = await synthesizeOutboundAudio(input.message, voiceConfig)
    } catch (error) {
      logger.warn(
        `[channels] TTS synthesis failed for conversation "${input.conversation.id}"; falling back to text-only payload:`,
        error,
      )
    }
  }

  if (binding.provider === 'email' && input.actionPolicyGate && options.enforceActionPolicy !== false) {
    const result = await input.actionPolicyGate.enforceAndWait({
      source: 'channel-reply',
      toolName: 'mcp__gmail__send',
      toolInput: {
        to: input.conversation.lastRoute?.to ?? binding.peerId,
        subject: input.conversation.channelMeta?.subject,
        body: input.message,
      },
      fallbackSessionName: input.conversation.id,
    })
    if (result.decision !== 'allow') {
      throw new Error(result.reason ?? 'Email reply denied by action policy')
    }
  }

  return {
    provider: binding.provider,
    binding,
    adapter,
    runtime: {
      provider: binding.provider,
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      surfaceBinding: binding,
    },
    payload,
    audioEligible,
  }
}

export async function dispatchChannelReply(
  input: DispatchChannelReplyInput,
): Promise<DispatchChannelReplyResult> {
  const prepared = await prepareChannelReplyDispatch(input)

  const result = await prepared.adapter.send(
    prepared.runtime,
    input.conversation,
    prepared.payload,
  )
  if (!result.success) {
    throw new Error(result.error || `Failed to dispatch ${prepared.binding.provider} channel reply`)
  }

  return {
    provider: prepared.provider,
    binding: prepared.binding,
    payload: prepared.payload,
  }
}

export async function createChannelReplyStreamDispatch(
  input: DispatchChannelReplyInput,
  options: {
    throttleMs?: number
  } = {},
): Promise<ChannelReplyStreamDispatch | null> {
  const prepared = await prepareChannelReplyDispatch(input, {
    includeAudio: false,
    enforceActionPolicy: false,
  })
  if (
    prepared.audioEligible ||
    prepared.payload.media?.length ||
    !prepared.adapter.capabilities.supportsMessageEdit ||
    !prepared.adapter.editMessage
  ) {
    return null
  }

  const throttleMs = Math.max(0, Math.floor(options.throttleMs ?? DEFAULT_CHANNEL_REPLY_EDIT_THROTTLE_MS))
  const logger = input.logger ?? console
  let messageRef: ChannelOutboundMessageRef | null = null
  let lastDeliveredText = ''
  let lastEditAt = 0
  let streamingDisabled = false
  let operation = Promise.resolve()

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = operation.then(task, task)
    operation = next.then(() => undefined, () => undefined)
    return next
  }

  const disableStreaming = (error: string): void => {
    if (streamingDisabled) {
      return
    }
    streamingDisabled = true
    logger.warn(
      `[channels] Progressive ${prepared.binding.provider} reply delivery disabled for conversation "${input.conversation.id}"; final reply will be sent separately: ${error}`,
    )
  }

  const finalOnlyDispatch = (message: string): Promise<DispatchChannelReplyResult> =>
    dispatchChannelReply({
      ...input,
      message,
    })

  const sendOrEdit = async (message: string, force: boolean): Promise<boolean> => {
    const text = message.trim()
    if (!text || text === lastDeliveredText || streamingDisabled) {
      return false
    }
    const now = Date.now()
    if (messageRef && !force && now - lastEditAt < throttleMs) {
      return false
    }
    const payload: ChannelOutboundPayload = {
      ...prepared.payload,
      text,
    }
    if (!messageRef) {
      const result = await prepared.adapter.send(prepared.runtime, input.conversation, payload)
      if (!result.success) {
        disableStreaming(result.error || `Failed to dispatch ${prepared.binding.provider} channel reply`)
        return false
      }
      if (!result.messageRef) {
        lastDeliveredText = text
        lastEditAt = now
        disableStreaming(`${prepared.binding.provider} did not return an editable message reference`)
        return false
      }
      messageRef = result.messageRef
    } else {
      const result = await prepared.adapter.editMessage!(
        prepared.runtime,
        input.conversation,
        messageRef,
        payload,
      )
      if (!result.success) {
        disableStreaming(result.error || `Failed to edit ${prepared.binding.provider} channel reply`)
        return false
      }
      messageRef = result.messageRef ?? messageRef
    }
    lastDeliveredText = text
    lastEditAt = now
    return true
  }

  const failStream = async (message: string): Promise<boolean> => {
    const text = message.trim()
    if (!text || !messageRef || streamingDisabled) {
      return false
    }
    const payload: ChannelOutboundPayload = {
      ...prepared.payload,
      text,
    }
    const result = await prepared.adapter.editMessage!(
      prepared.runtime,
      input.conversation,
      messageRef,
      payload,
    )
    if (!result.success) {
      disableStreaming(result.error || `Failed to edit ${prepared.binding.provider} channel reply`)
      return false
    }
    messageRef = result.messageRef ?? messageRef
    lastDeliveredText = text
    lastEditAt = Date.now()
    return true
  }

  return {
    update(message: string) {
      return enqueue(async () => {
        await sendOrEdit(message, false)
      })
    },
    finalize(message: string) {
      return enqueue(async () => {
        const text = message.trim()
        if (!text) {
          throw new Error('Cannot finalize an empty channel reply')
        }
        if (messageRef && text === lastDeliveredText) {
          return {
            provider: prepared.provider,
            binding: prepared.binding,
            payload: {
              ...prepared.payload,
              text,
            },
          }
        }
        const deliveredByEdit = await sendOrEdit(text, true)
        if (!deliveredByEdit) {
          const undeliveredSuffix = lastDeliveredText && text.startsWith(lastDeliveredText)
            ? text.slice(lastDeliveredText.length)
            : text
          if (!undeliveredSuffix.trim()) {
            return {
              provider: prepared.provider,
              binding: prepared.binding,
              payload: {
                ...prepared.payload,
                text,
              },
            }
          }
          return finalOnlyDispatch(undeliveredSuffix)
        }
        return {
          provider: prepared.provider,
          binding: prepared.binding,
          payload: {
            ...prepared.payload,
            text,
          },
        }
      })
    },
    fail(message: string) {
      return enqueue(() => failStream(message))
    },
  }
}
