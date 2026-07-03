import WebSocket from 'ws'
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
import { parseDiscordChannelConfig, type DiscordChannelConfig } from './config.js'

type WebSocketLike = Pick<WebSocket, 'close' | 'send' | 'on' | 'readyState'>
type WebSocketFactory = (url: string) => WebSocketLike

interface DiscordRuntime extends ChannelRuntime<DiscordChannelConfig> {
  botToken: string
  socket?: WebSocketLike
  heartbeatTimer?: NodeJS.Timeout
  sequence?: number
  sessionId?: string
  botUserId?: string
  startedAt: string
  state: 'connecting' | 'ready' | 'disconnected' | 'error'
  lastEventAt?: string
  lastError?: string
  lastDrop?: ChannelLastDrop
}

interface DiscordGatewayPayload {
  op?: number
  d?: unknown
  s?: number | null
  t?: string | null
}

interface DiscordUser {
  id?: string
  username?: string
  global_name?: string | null
  bot?: boolean
}

interface DiscordMessageCreate {
  id?: string
  channel_id?: string
  guild_id?: string
  content?: string
  timestamp?: string
  author?: DiscordUser
  mentions?: DiscordUser[]
  thread?: { id?: string; parent_id?: string; name?: string }
  channel?: { id?: string; parent_id?: string; name?: string; type?: number }
  message_reference?: { channel_id?: string; guild_id?: string; message_id?: string }
}

interface DiscordReadyEvent {
  session_id?: string
  user?: DiscordUser
}

interface DiscordChannelMessagePayload {
  provider: 'discord'
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

export interface DiscordChannelAdapterOptions {
  bindingStore: CommanderChannelBindingStore
  secretsStore?: CommanderSecretsStore
  internalToken: string
  apiBaseUrl?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  webSocketFactory?: WebSocketFactory
  logger?: Pick<Console, 'warn' | 'error' | 'log'>
}

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

function resolveApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.HERD_API_BASE_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/u, '')
  }
  const port = env.PORT?.trim() || '20001'
  return `http://127.0.0.1:${port}`
}

function stringifyData(data: WebSocket.RawData): string {
  return Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : String(data)
}

function parseJson(data: WebSocket.RawData): DiscordGatewayPayload | null {
  try {
    return JSON.parse(stringifyData(data)) as DiscordGatewayPayload
  } catch {
    return null
  }
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

function userDisplayName(user: DiscordUser | undefined, fallback: string): string {
  return user?.global_name?.trim() || user?.username?.trim() || fallback
}

function isDirectMessage(message: DiscordMessageCreate): boolean {
  return !message.guild_id
}

function parentChannelId(message: DiscordMessageCreate): string | undefined {
  return message.thread?.parent_id
    ?? message.channel?.parent_id
    ?? message.message_reference?.channel_id
}

function mentionedBot(message: DiscordMessageCreate, botUserId: string | undefined): boolean {
  if (!botUserId) {
    return false
  }
  if (message.content?.includes(`<@${botUserId}>`) || message.content?.includes(`<@!${botUserId}>`)) {
    return true
  }
  return message.mentions?.some((user) => user.id === botUserId) ?? false
}

export class DiscordChannelAdapter implements ChannelAdapter<DiscordChannelConfig> {
  readonly provider = 'discord' as const
  readonly capabilities = {
    voiceNotes: false,
    media: false,
    threading: true,
    typingIndicators: false,
    presence: false,
    reactions: false,
    markdownDialect: 'discord' as const,
  }

  private readonly bindingStore: CommanderChannelBindingStore
  private readonly secretsStore: CommanderSecretsStore
  private readonly internalToken: string
  private readonly apiBaseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly webSocketFactory: WebSocketFactory
  private readonly logger: Pick<Console, 'warn' | 'error' | 'log'>
  private readonly runtimesByAccount = new Map<string, DiscordRuntime>()

  constructor(options: DiscordChannelAdapterOptions) {
    this.bindingStore = options.bindingStore
    this.secretsStore = options.secretsStore ?? new CommanderSecretsStore()
    this.internalToken = options.internalToken
    this.apiBaseUrl = (options.apiBaseUrl ?? resolveApiBaseUrl(options.env ?? process.env)).replace(/\/+$/u, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url))
    this.logger = options.logger ?? console
  }

  normalizeInbound(payload: unknown): ChannelInboundEvent {
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const accountId = typeof raw.accountId === 'string' ? raw.accountId : 'default'
    const peerId = typeof raw.peerId === 'string' ? raw.peerId : 'unknown'
    return {
      provider: 'discord',
      accountId,
      chatType: typeof raw.chatType === 'string' ? raw.chatType : 'channel',
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

  async start(binding: CommanderChannelBinding): Promise<DiscordRuntime> {
    const config = parseDiscordChannelConfig(binding.config, binding.accountId)
    if (!config.credentialRef) {
      throw new Error(`Discord channel "${binding.displayName}" is missing a bot token`)
    }
    const botToken = await this.secretsStore.getSecret(binding.commanderId, config.credentialRef)
    if (!botToken) {
      throw new Error(`Discord channel "${binding.displayName}" bot token is missing from the encrypted vault`)
    }
    const existing = this.runtimesByAccount.get(binding.accountId)
    if (existing) {
      await this.stop(existing)
    }
    const runtime: DiscordRuntime = {
      provider: 'discord',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config,
      accountBinding: binding,
      botToken,
      botUserId: config.botUserId,
      startedAt: new Date().toISOString(),
      state: 'connecting',
    }
    this.runtimesByAccount.set(binding.accountId, runtime)
    this.connect(runtime)
    return runtime
  }

  async stop(runtime: ChannelRuntime<DiscordChannelConfig>): Promise<void> {
    const discordRuntime = runtime as DiscordRuntime
    discordRuntime.state = 'disconnected'
    if (discordRuntime.heartbeatTimer) {
      clearInterval(discordRuntime.heartbeatTimer)
      discordRuntime.heartbeatTimer = undefined
    }
    discordRuntime.socket?.close()
    discordRuntime.socket = undefined
    const active = this.runtimesByAccount.get(discordRuntime.accountId)
    if (!active || active.commanderId === discordRuntime.commanderId) {
      this.runtimesByAccount.delete(discordRuntime.accountId)
    }
  }

  async beginPairing(input: { provider: 'discord'; commanderId: string }) {
    return {
      provider: 'discord' as const,
      commanderId: input.commanderId,
      kind: 'bot-token',
      instructions: 'Create the Discord binding by saving the bot token from the Discord Developer Portal.',
    }
  }

  async completePairing(): Promise<CommanderChannelBinding> {
    throw new Error('Discord pairing is completed by saving the channel binding')
  }

  async send(
    runtime: ChannelRuntime<DiscordChannelConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ) {
    try {
      const binding = await this.resolveBinding(runtime, conversation)
      const config = parseDiscordChannelConfig(binding.config, binding.accountId)
      if (!config.credentialRef) {
        return { success: false as const, error: 'Discord bot token is not configured' }
      }
      const botToken = await this.secretsStore.getSecret(binding.commanderId, config.credentialRef)
      if (!botToken) {
        return { success: false as const, error: 'Discord bot token is missing from the encrypted vault' }
      }
      const channelId = conversation.lastRoute?.threadId ?? conversation.lastRoute?.to ?? runtime.surfaceBinding?.peerId
      if (!channelId) {
        return { success: false as const, error: `No Discord channel id for conversation "${conversation.id}"` }
      }
      const chunks = chunkText(payload.text ?? '', config.maxMessageLength)
      if (chunks.length === 0) {
        return { success: false as const, error: 'Discord outbound text is empty' }
      }
      const responses: unknown[] = []
      for (const content of chunks) {
        responses.push(await this.callDiscordApi(botToken, `/channels/${encodeURIComponent(channelId)}/messages`, {
          content,
        }))
      }
      return { success: true as const, rawResponse: responses.length === 1 ? responses[0] : responses }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Failed to send Discord message',
      }
    }
  }

  async checkInboundAllowed(
    runtime: ChannelRuntime<DiscordChannelConfig>,
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
    const config = parseDiscordChannelConfig(binding.config, binding.accountId)
    if (event.chatType !== 'direct' && config.requireMention) {
      const metadata = event.metadata?.discord
      const wasMentioned = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).mentionedBot === true
        : false
      return wasMentioned ? decision : { allowed: false, reason: 'mention-required' }
    }
    return decision
  }

  async getStatus(binding: CommanderChannelBinding): Promise<ChannelAdapterStatus> {
    const runtime = this.runtimesByAccount.get(binding.accountId)
    const config = parseDiscordChannelConfig(binding.config, binding.accountId)
    return {
      provider: 'discord',
      accountId: binding.accountId,
      transport: 'discord-gateway',
      state: binding.enabled ? (runtime?.state ?? 'configured') : 'stopped',
      connected: binding.enabled && config.credentialConfigured && runtime?.state === 'ready',
      ...(runtime?.lastError ? { lastError: runtime.lastError } : {}),
      ...(runtime?.lastEventAt ? { lastEventAt: runtime.lastEventAt } : {}),
      ...(runtime?.lastDrop ? { lastDrop: runtime.lastDrop } : {}),
      metadata: {
        credentialConfigured: config.credentialConfigured,
        gatewayIntents: config.gatewayIntents,
        ...(runtime?.botUserId ?? config.botUserId ? { botUserId: runtime?.botUserId ?? config.botUserId } : {}),
      },
    }
  }

  private connect(runtime: DiscordRuntime): void {
    const socket = this.webSocketFactory(DISCORD_GATEWAY_URL)
    runtime.socket = socket
    socket.on('message', (data) => {
      const payload = parseJson(data as WebSocket.RawData)
      if (payload) {
        void this.handleGatewayPayload(runtime, payload)
      }
    })
    socket.on('close', () => {
      if (runtime.state !== 'disconnected') {
        runtime.state = 'disconnected'
      }
    })
    socket.on('error', (error) => {
      runtime.state = 'error'
      runtime.lastError = error instanceof Error ? error.message : 'Discord gateway error'
      this.logger.warn(`[channels/discord] Gateway error for ${runtime.accountId}:`, error)
    })
  }

  private async handleGatewayPayload(runtime: DiscordRuntime, payload: DiscordGatewayPayload): Promise<void> {
    if (typeof payload.s === 'number') {
      runtime.sequence = payload.s
    }
    if (payload.op === 10) {
      const hello = payload.d && typeof payload.d === 'object' ? payload.d as { heartbeat_interval?: number } : {}
      this.startHeartbeat(runtime, hello.heartbeat_interval ?? 45_000)
      runtime.socket?.send(JSON.stringify({
        op: 2,
        d: {
          token: runtime.botToken,
          intents: runtime.config?.gatewayIntents ?? 37_377,
          properties: {
            os: process.platform,
            browser: 'herd',
            device: 'herd',
          },
        },
      }))
      return
    }
    if (payload.op !== 0) {
      return
    }
    if (payload.t === 'READY') {
      const ready = payload.d && typeof payload.d === 'object' ? payload.d as DiscordReadyEvent : {}
      runtime.sessionId = ready.session_id
      runtime.botUserId = ready.user?.id ?? runtime.botUserId
      runtime.state = 'ready'
      runtime.lastError = undefined
      return
    }
    if (payload.t === 'MESSAGE_CREATE') {
      const message = payload.d && typeof payload.d === 'object' ? payload.d as DiscordMessageCreate : null
      const event = message ? this.eventFromMessage(runtime, message) : null
      if (!event) {
        return
      }
      await this.forwardInbound(event)
      runtime.lastEventAt = new Date().toISOString()
      runtime.lastError = undefined
    }
  }

  private startHeartbeat(runtime: DiscordRuntime, intervalMs: number): void {
    if (runtime.heartbeatTimer) {
      clearInterval(runtime.heartbeatTimer)
    }
    const heartbeat = () => {
      runtime.socket?.send(JSON.stringify({ op: 1, d: runtime.sequence ?? null }))
    }
    runtime.heartbeatTimer = setInterval(heartbeat, intervalMs)
    runtime.heartbeatTimer.unref?.()
    heartbeat()
  }

  private eventFromMessage(runtime: DiscordRuntime, message: DiscordMessageCreate): ChannelInboundEvent | null {
    if (!message.channel_id || !message.id || message.author?.bot) {
      return null
    }
    const content = message.content?.trim()
    if (!content) {
      return null
    }
    const direct = isDirectMessage(message)
    const parentId = parentChannelId(message)
    const peerId = parentId ?? message.channel_id
    const threadId = parentId ? message.channel_id : undefined
    const botUserId = runtime.botUserId ?? runtime.config?.botUserId
    return {
      provider: 'discord',
      accountId: runtime.accountId,
      chatType: direct ? 'direct' : 'channel',
      peerId,
      peerDisplayName: direct
        ? userDisplayName(message.author, peerId)
        : threadId
          ? `${peerId} / ${threadId}`
          : peerId,
      ...(message.guild_id ? { groupId: message.guild_id } : {}),
      ...(threadId ? { threadId } : {}),
      text: content,
      rawTimestamp: message.timestamp ?? new Date().toISOString(),
      rawSourceId: message.id,
      metadata: {
        discord: {
          channelId: message.channel_id,
          ...(message.guild_id ? { guildId: message.guild_id } : {}),
          ...(message.author?.id ? { authorId: message.author.id } : {}),
          mentionedBot: direct || mentionedBot(message, botUserId),
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
    const payload: DiscordChannelMessagePayload = {
      provider: 'discord',
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
      this.logger.warn(`[channels/discord] Failed to ingest Discord message ${event.rawSourceId}: ${response.status} ${text}`)
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
    runtime: DiscordRuntime,
    event: ChannelInboundEvent,
    reason: string,
  ): void {
    const at = new Date().toISOString()
    runtime.lastEventAt = at
    runtime.lastDrop = buildChannelLastDrop(event, reason, at)
    this.logger.warn(
      `[channels/discord] Dropped Discord message ${event.rawSourceId}: inbound denied ${reason} (${event.chatType} ${event.peerId})`,
    )
  }

  private postInboundPayload(payload: DiscordChannelMessagePayload): Promise<Response> {
    return this.fetchImpl(`${this.apiBaseUrl}/api/commanders/channel-message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-herd-internal-token': this.internalToken,
      },
      body: JSON.stringify(payload),
    })
  }

  private async callDiscordApi(botToken: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(`https://discord.com/api/v10${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${botToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const parsed = await response.json().catch(() => null)
    if (!response.ok) {
      const message = parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : `Discord API failed with HTTP ${response.status}`
      throw new Error(message)
    }
    return parsed
  }

  private async resolveBinding(
    runtime: ChannelRuntime<DiscordChannelConfig>,
    conversation: Conversation,
  ): Promise<CommanderChannelBinding> {
    const bindings = await this.bindingStore.listByCommander(conversation.commanderId)
    const binding = bindings.find((candidate) => (
      candidate.provider === 'discord'
      && candidate.accountId === runtime.accountId
      && candidate.enabled
    ))
    if (!binding) {
      throw new Error(`No Discord channel binding for commander "${conversation.commanderId}" and account "${runtime.accountId}"`)
    }
    return binding
  }

  private async resolveBindingForEvent(
    runtime: ChannelRuntime<DiscordChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<CommanderChannelBinding> {
    const bindings = (await this.bindingStore.list()).filter((candidate) => (
      candidate.provider === 'discord'
      && candidate.accountId === event.accountId
      && candidate.enabled
    ))
    const binding = bindings.length === 1
      ? bindings[0]
      : bindings.find((candidate) => candidate.commanderId === runtime.commanderId)
    if (!binding) {
      throw new Error(`No unambiguous Discord channel binding for account "${event.accountId}"`)
    }
    return binding
  }
}
