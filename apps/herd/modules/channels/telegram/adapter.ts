import { checkAccountInboundPolicy } from '../policy.js'
import { effectiveBindingCommanderId } from '../binding-routing.js'
import { buildChannelLastDrop, readDroppedChannelResponse } from '../drop-status.js'
import type { CommanderChannelBindingStore } from '../store.js'
import type {
  ChannelAdapter,
  ChannelAdapterStatus,
  ChannelInboundDecision,
  ChannelInboundEvent,
  ChannelLastDrop,
  ChannelOutboundPayload,
  ChannelRuntime,
  CommanderChannelBinding,
} from '../types.js'
import { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import type { Conversation } from '../../commanders/conversation-store.js'
import { parseTelegramChannelConfig, type TelegramChannelConfig } from './config.js'

interface TelegramRuntime extends ChannelRuntime<TelegramChannelConfig> {
  botToken: string
  stopped: boolean
  polling: boolean
  nextOffset?: number
  timer?: NodeJS.Timeout
  startedAt: string
  lastEventAt?: string
  lastError?: string
  lastDrop?: ChannelLastDrop
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

interface TelegramUser {
  id?: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramChat {
  id?: number | string
  type?: string
  title?: string
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramMessage {
  message_id?: number
  message_thread_id?: number
  date?: number
  text?: string
  caption?: string
  from?: TelegramUser
  chat?: TelegramChat
  is_topic_message?: boolean
}

interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
}

interface TelegramChannelMessagePayload {
  provider: 'telegram'
  accountId: string
  chatType: string
  peerId: string
  displayName: string
  message: string
  mode: 'followup'
  commanderId?: string
  groupId?: string
  threadId?: string
  rawTimestamp: string | number
  rawSourceId: string
  metadata?: Record<string, unknown>
}

export interface TelegramChannelAdapterOptions {
  bindingStore: CommanderChannelBindingStore
  secretsStore?: CommanderSecretsStore
  internalToken: string
  apiBaseUrl?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  logger?: Pick<Console, 'warn' | 'error' | 'log'>
}

function resolveApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.HERD_API_BASE_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/u, '')
  }
  const port = env.PORT?.trim() || '20001'
  return `http://127.0.0.1:${port}`
}

function displayNameFromUser(user: TelegramUser | undefined, fallback: string): string {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
  return name || user?.username || fallback
}

function displayNameFromChat(chat: TelegramChat | undefined, fallback: string): string {
  const name = chat?.title ?? [chat?.first_name, chat?.last_name].filter(Boolean).join(' ').trim()
  return name || chat?.username || fallback
}

function cleanText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function chunkText(text: string, maxLength: number): string[] {
  const normalized = text.trim()
  if (!normalized) {
    return []
  }
  const chunks: string[] = []
  for (let index = 0; index < normalized.length; index += maxLength) {
    chunks.push(normalized.slice(index, index + maxLength))
  }
  return chunks
}

function isRuntimeHealthy(runtime: TelegramRuntime | undefined): runtime is TelegramRuntime {
  return Boolean(runtime && !runtime.stopped && !runtime.lastError)
}

function telegramTextMentionsBot(text: string | undefined, botUsername: string | undefined): boolean {
  const normalizedUsername = botUsername?.replace(/^@/u, '').trim().toLowerCase()
  if (!normalizedUsername) {
    return false
  }
  return text?.toLowerCase().includes(`@${normalizedUsername}`) ?? false
}

function chatTypeForMessage(message: TelegramMessage): ChannelInboundEvent['chatType'] {
  if (message.is_topic_message || message.message_thread_id !== undefined) {
    return 'forum-topic'
  }
  if (message.chat?.type === 'private') {
    return 'direct'
  }
  if (message.chat?.type === 'channel') {
    return 'channel'
  }
  return 'group'
}

function rawSourceId(update: TelegramUpdate, message: TelegramMessage): string {
  const updateId = update.update_id !== undefined ? `update:${update.update_id}` : ''
  const messageId = message.message_id !== undefined ? `message:${message.message_id}` : ''
  return [updateId, messageId].filter(Boolean).join(':') || `${Date.now()}`
}

export class TelegramChannelAdapter implements ChannelAdapter<TelegramChannelConfig> {
  readonly provider = 'telegram' as const
  readonly capabilities = {
    voiceNotes: false,
    media: false,
    threading: true,
    typingIndicators: false,
    presence: false,
    reactions: false,
    markdownDialect: 'telegram' as const,
  }

  private readonly bindingStore: CommanderChannelBindingStore
  private readonly secretsStore: CommanderSecretsStore
  private readonly internalToken: string
  private readonly apiBaseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly logger: Pick<Console, 'warn' | 'error' | 'log'>
  private readonly runtimesByAccount = new Map<string, TelegramRuntime>()

  constructor(options: TelegramChannelAdapterOptions) {
    this.bindingStore = options.bindingStore
    this.secretsStore = options.secretsStore ?? new CommanderSecretsStore()
    this.internalToken = options.internalToken
    this.apiBaseUrl = (options.apiBaseUrl ?? resolveApiBaseUrl(options.env ?? process.env)).replace(/\/+$/u, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.logger = options.logger ?? console
  }

  normalizeInbound(payload: unknown): ChannelInboundEvent {
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const accountId = typeof raw.accountId === 'string' ? raw.accountId : 'default'
    const peerId = typeof raw.peerId === 'string' ? raw.peerId : 'unknown'
    return {
      provider: 'telegram',
      accountId,
      chatType: typeof raw.chatType === 'string' ? raw.chatType : 'direct',
      peerId,
      ...(typeof raw.displayName === 'string' ? { peerDisplayName: raw.displayName } : {}),
      ...(typeof raw.groupId === 'string' ? { groupId: raw.groupId } : {}),
      ...(typeof raw.threadId === 'string' ? { threadId: raw.threadId } : {}),
      ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
      ...(raw.metadata && typeof raw.metadata === 'object' ? { metadata: { ...raw.metadata } as Record<string, unknown> } : {}),
      rawTimestamp: typeof raw.rawTimestamp === 'number' || typeof raw.rawTimestamp === 'string'
        ? raw.rawTimestamp
        : new Date().toISOString(),
      rawSourceId: typeof raw.rawSourceId === 'string' ? raw.rawSourceId : `${accountId}:${peerId}:${Date.now()}`,
    }
  }

  async start(binding: CommanderChannelBinding): Promise<TelegramRuntime> {
    const config = parseTelegramChannelConfig(binding.config, binding.accountId)
    if (!config.credentialRef) {
      throw new Error(`Telegram channel "${binding.displayName}" is missing a bot token`)
    }
    const botToken = await this.secretsStore.getSecret(binding.commanderId, config.credentialRef)
    if (!botToken) {
      throw new Error(`Telegram channel "${binding.displayName}" bot token is missing from the encrypted vault`)
    }
    const existing = this.runtimesByAccount.get(binding.accountId)
    if (existing) {
      await this.stop(existing)
    }
    const runtime: TelegramRuntime = {
      provider: 'telegram',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config,
      accountBinding: binding,
      botToken,
      stopped: false,
      polling: false,
      startedAt: new Date().toISOString(),
    }
    this.runtimesByAccount.set(binding.accountId, runtime)
    this.schedulePoll(runtime, 250)
    return runtime
  }

  async stop(runtime: ChannelRuntime<TelegramChannelConfig>): Promise<void> {
    const telegramRuntime = runtime as TelegramRuntime
    telegramRuntime.stopped = true
    if (telegramRuntime.timer) {
      clearTimeout(telegramRuntime.timer)
      telegramRuntime.timer = undefined
    }
    const active = this.runtimesByAccount.get(telegramRuntime.accountId)
    if (!active || active.commanderId === telegramRuntime.commanderId) {
      this.runtimesByAccount.delete(telegramRuntime.accountId)
    }
  }

  async beginPairing(input: { provider: 'telegram'; commanderId: string }) {
    return {
      provider: 'telegram' as const,
      commanderId: input.commanderId,
      kind: 'bot-token',
      instructions: 'Create the Telegram binding by saving the bot token from @BotFather.',
    }
  }

  async completePairing(): Promise<CommanderChannelBinding> {
    throw new Error('Telegram pairing is completed by saving the channel binding')
  }

  async send(
    runtime: ChannelRuntime<TelegramChannelConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ) {
    try {
      const binding = await this.resolveBinding(runtime, conversation)
      const config = parseTelegramChannelConfig(binding.config, binding.accountId)
      if (!config.credentialRef) {
        return { success: false as const, error: 'Telegram bot token is not configured' }
      }
      const botToken = await this.secretsStore.getSecret(binding.commanderId, config.credentialRef)
      if (!botToken) {
        return { success: false as const, error: 'Telegram bot token is missing from the encrypted vault' }
      }
      const chatId = conversation.lastRoute?.to ?? runtime.surfaceBinding?.peerId
      if (!chatId) {
        return { success: false as const, error: `No Telegram chat id for conversation "${conversation.id}"` }
      }
      const chunks = chunkText(payload.text ?? '', config.maxMessageLength)
      if (chunks.length === 0) {
        return { success: false as const, error: 'Telegram outbound text is empty' }
      }
      const responses: unknown[] = []
      for (const text of chunks) {
        responses.push(await this.callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text,
          ...(conversation.lastRoute?.threadId ? { message_thread_id: Number(conversation.lastRoute.threadId) } : {}),
        }))
      }
      return { success: true as const, rawResponse: responses.length === 1 ? responses[0] : responses }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Failed to send Telegram message',
      }
    }
  }

  async checkInboundAllowed(
    runtime: ChannelRuntime<TelegramChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<ChannelInboundDecision> {
    const binding = await this.resolveBindingForEvent(runtime, event)
    return this.checkInboundAllowedForBinding(binding, event)
  }

  private checkInboundAllowedForBinding(
    binding: CommanderChannelBinding,
    event: ChannelInboundEvent,
  ): ChannelInboundDecision {
    const decision = checkAccountInboundPolicy(binding, event)
    if (!decision.allowed) {
      return decision
    }
    const config = parseTelegramChannelConfig(binding.config, binding.accountId)
    if (event.chatType !== 'direct' && config.requireMention) {
      return telegramTextMentionsBot(event.text, config.botUsername)
        ? decision
        : { allowed: false, reason: 'mention-required' }
    }
    return decision
  }

  async getStatus(binding: CommanderChannelBinding): Promise<ChannelAdapterStatus> {
    const runtime = this.runtimesByAccount.get(binding.accountId)
    const config = parseTelegramChannelConfig(binding.config, binding.accountId)
    const healthyRuntime = isRuntimeHealthy(runtime)
    return {
      provider: 'telegram',
      accountId: binding.accountId,
      transport: 'telegram-long-polling',
      state: binding.enabled ? (runtime?.lastError ? 'error' : runtime ? 'polling' : 'configured') : 'stopped',
      connected: binding.enabled && config.credentialConfigured && healthyRuntime,
      ...(runtime?.lastError ? { lastError: runtime.lastError } : {}),
      ...(runtime?.lastEventAt ? { lastEventAt: runtime.lastEventAt } : {}),
      ...(runtime?.lastDrop ? { lastDrop: runtime.lastDrop } : {}),
      metadata: {
        credentialConfigured: config.credentialConfigured,
        ...(config.botUsername ? { botUsername: config.botUsername } : {}),
      },
    }
  }

  private schedulePoll(runtime: TelegramRuntime, delayMs = runtime.config?.pollIntervalMs ?? 5_000): void {
    if (runtime.stopped) {
      return
    }
    if (runtime.timer) {
      clearTimeout(runtime.timer)
    }
    runtime.timer = setTimeout(() => {
      void this.pollOnce(runtime).finally(() => {
        this.schedulePoll(runtime)
      })
    }, delayMs)
    runtime.timer.unref?.()
  }

  private async pollOnce(runtime: TelegramRuntime): Promise<void> {
    if (runtime.stopped || runtime.polling) {
      return
    }
    runtime.polling = true
    try {
      const updates = await this.callTelegramApi<TelegramUpdate[]>(runtime.botToken, 'getUpdates', {
        ...(runtime.nextOffset !== undefined ? { offset: runtime.nextOffset } : {}),
        timeout: runtime.config?.longPollTimeoutSeconds ?? 25,
        allowed_updates: ['message', 'edited_message', 'channel_post'],
      })
      for (const update of updates) {
        if (typeof update.update_id === 'number') {
          runtime.nextOffset = Math.max(runtime.nextOffset ?? 0, update.update_id + 1)
        }
        const event = this.eventFromUpdate(runtime, update)
        if (!event) {
          continue
        }
        await this.forwardInbound(event)
        runtime.lastEventAt = new Date().toISOString()
      }
      runtime.lastError = undefined
    } catch (error) {
      runtime.lastError = error instanceof Error ? error.message : 'Telegram poll failed'
      this.logger.warn(`[channels/telegram] Poll failed for ${runtime.accountId}:`, error)
    } finally {
      runtime.polling = false
    }
  }

  private eventFromUpdate(runtime: TelegramRuntime, update: TelegramUpdate): ChannelInboundEvent | null {
    const message = update.message ?? update.edited_message ?? update.channel_post
    if (!message?.chat?.id) {
      return null
    }
    if (message.from?.is_bot) {
      return null
    }
    const text = cleanText(message.text) || cleanText(message.caption)
    if (!text) {
      return null
    }
    const chatType = chatTypeForMessage(message)
    const peerId = String(message.chat.id)
    const displayName = chatType === 'direct'
      ? displayNameFromUser(message.from, peerId)
      : displayNameFromChat(message.chat, peerId)
    const threadId = message.message_thread_id !== undefined ? String(message.message_thread_id) : undefined
    return {
      provider: 'telegram',
      accountId: runtime.accountId,
      chatType,
      peerId,
      peerDisplayName: threadId ? `${displayName} / Topic ${threadId}` : displayName,
      ...(chatType !== 'direct' ? { groupId: peerId } : {}),
      ...(threadId ? { threadId } : {}),
      text,
      rawTimestamp: message.date ? message.date * 1000 : new Date().toISOString(),
      rawSourceId: rawSourceId(update, message),
      metadata: {
        telegram: {
          updateId: update.update_id,
          messageId: message.message_id,
          chatType: message.chat.type,
          ...(message.from?.id !== undefined ? { fromId: String(message.from.id) } : {}),
          ...(message.from?.username ? { fromUsername: message.from.username } : {}),
        },
      },
    }
  }

  private async forwardInbound(event: ChannelInboundEvent): Promise<void> {
    const runtime = this.runtimesByAccount.get(event.accountId)
    if (!runtime) {
      return
    }
    const binding = await this.resolveBindingForEvent(runtime, event).catch(() => null)
    if (!binding) {
      this.recordDroppedInbound(runtime, event, 'binding-resolution')
      return
    }
    const decision = this.checkInboundAllowedForBinding(binding, event)
    if (!decision.allowed) {
      this.recordDroppedInbound(runtime, event, decision.reason ?? 'policy-denied')
      return
    }
    const payload: TelegramChannelMessagePayload = {
      provider: 'telegram',
      accountId: event.accountId,
      chatType: event.chatType,
      peerId: event.peerId,
      displayName: event.peerDisplayName ?? event.peerId,
      message: event.text ?? '',
      mode: 'followup',
      commanderId: effectiveBindingCommanderId(binding),
      ...(event.groupId ? { groupId: event.groupId } : {}),
      ...(event.threadId ? { threadId: event.threadId } : {}),
      rawTimestamp: event.rawTimestamp,
      rawSourceId: event.rawSourceId,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    }
    const response = await this.postInboundPayload(payload)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      this.logger.warn(`[channels/telegram] Failed to ingest Telegram message ${event.rawSourceId}: ${response.status} ${text}`)
      return
    }
    const droppedReason = await readDroppedChannelResponse(response)
    if (droppedReason) {
      this.recordDroppedInbound(runtime, event, droppedReason)
      return
    }
    runtime.lastEventAt = new Date().toISOString()
    runtime.lastError = undefined
  }

  private recordDroppedInbound(
    runtime: TelegramRuntime,
    event: ChannelInboundEvent,
    reason: string,
  ): void {
    const at = new Date().toISOString()
    runtime.lastEventAt = at
    runtime.lastDrop = buildChannelLastDrop(event, reason, at)
    this.logger.warn(
      `[channels/telegram] Dropped Telegram message ${event.rawSourceId}: inbound denied ${reason} (${event.chatType} ${event.peerId})`,
    )
  }

  private postInboundPayload(payload: TelegramChannelMessagePayload): Promise<Response> {
    return this.fetchImpl(`${this.apiBaseUrl}/api/commanders/channel-message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-herd-internal-token': this.internalToken,
      },
      body: JSON.stringify(payload),
    })
  }

  private async callTelegramApi<T = unknown>(
    botToken: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = await response.json().catch(() => null) as TelegramApiResponse<T> | null
    if (!response.ok || !parsed?.ok) {
      throw new Error(parsed?.description ?? `Telegram ${method} failed with HTTP ${response.status}`)
    }
    return parsed.result as T
  }

  private async resolveBinding(
    runtime: ChannelRuntime<TelegramChannelConfig>,
    conversation: Conversation,
  ): Promise<CommanderChannelBinding> {
    const bindings = await this.bindingStore.listByCommander(conversation.commanderId)
    const binding = bindings.find((candidate) => (
      candidate.provider === 'telegram'
      && candidate.accountId === runtime.accountId
      && candidate.enabled
    ))
    if (!binding) {
      throw new Error(`No Telegram channel binding for commander "${conversation.commanderId}" and account "${runtime.accountId}"`)
    }
    return binding
  }

  private async resolveBindingForEvent(
    runtime: ChannelRuntime<TelegramChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<CommanderChannelBinding> {
    const bindings = (await this.bindingStore.list()).filter((candidate) => (
      candidate.provider === 'telegram'
      && candidate.accountId === event.accountId
      && candidate.enabled
    ))
    const binding = bindings.length === 1
      ? bindings[0]
      : bindings.find((candidate) => candidate.commanderId === runtime.commanderId)
    if (!binding) {
      throw new Error(`No unambiguous Telegram channel binding for account "${event.accountId}"`)
    }
    return binding
  }
}
