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
import { parseSlackChannelConfig, type SlackChannelConfig } from './config.js'

type WebSocketLike = Pick<WebSocket, 'close' | 'send' | 'on' | 'readyState'>
type WebSocketFactory = (url: string) => WebSocketLike

interface SlackRuntime extends ChannelRuntime<SlackChannelConfig> {
  botToken: string
  appToken: string
  socket?: WebSocketLike
  startedAt: string
  state: 'connecting' | 'ready' | 'disconnected' | 'error'
  lastEventAt?: string
  lastError?: string
  lastDrop?: ChannelLastDrop
  lastDeniedInbound?: SlackDeniedInboundStatus
}

interface SlackDeniedInboundStatus {
  reason: string
  at: string
  chatType: string
  peerId: string
  rawSourceId: string
  groupId?: string
  threadId?: string
}

interface SlackSocketEnvelope {
  envelope_id?: string
  type?: string
  payload?: unknown
  retry_attempt?: number
}

interface SlackEventCallback {
  type?: string
  team_id?: string
  authorizations?: Array<{ user_id?: string; team_id?: string }>
  event?: SlackMessageEvent
}

interface SlackMessageEvent {
  type?: string
  subtype?: string
  channel?: string
  channel_type?: string
  user?: string
  bot_id?: string
  text?: string
  ts?: string
  thread_ts?: string
  event_ts?: string
}

interface SlackChannelMessagePayload {
  provider: 'slack'
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

export interface SlackChannelAdapterOptions {
  bindingStore: CommanderChannelBindingStore
  secretsStore?: CommanderSecretsStore
  internalToken: string
  apiBaseUrl?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  webSocketFactory?: WebSocketFactory
  logger?: Pick<Console, 'warn' | 'error' | 'log'>
}

interface SlackApiResponse<T = unknown> {
  ok?: boolean
  error?: string
  url?: string
  response_metadata?: { messages?: string[] }
  [key: string]: unknown
}

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

function parseEnvelope(data: WebSocket.RawData): SlackSocketEnvelope | null {
  try {
    return JSON.parse(stringifyData(data)) as SlackSocketEnvelope
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function chatTypeForSlack(event: SlackMessageEvent): ChannelInboundEvent['chatType'] {
  return event.channel_type === 'im' ? 'direct' : 'channel'
}

function mentionedBot(event: SlackMessageEvent, botUserId: string | undefined): boolean {
  if (!botUserId) {
    return false
  }
  return event.text?.includes(`<@${botUserId}>`) ?? false
}

export class SlackChannelAdapter implements ChannelAdapter<SlackChannelConfig> {
  readonly provider = 'slack' as const
  readonly capabilities = {
    voiceNotes: false,
    media: false,
    threading: true,
    typingIndicators: false,
    presence: false,
    reactions: false,
    markdownDialect: 'slack' as const,
  }

  private readonly bindingStore: CommanderChannelBindingStore
  private readonly secretsStore: CommanderSecretsStore
  private readonly internalToken: string
  private readonly apiBaseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly webSocketFactory: WebSocketFactory
  private readonly logger: Pick<Console, 'warn' | 'error' | 'log'>
  private readonly runtimesByAccount = new Map<string, SlackRuntime>()

  constructor(options: SlackChannelAdapterOptions) {
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
      provider: 'slack',
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

  async start(binding: CommanderChannelBinding): Promise<SlackRuntime> {
    const config = parseSlackChannelConfig(binding.config, binding.accountId)
    if (!config.botTokenRef || !config.appTokenRef) {
      throw new Error(`Slack channel "${binding.displayName}" is missing bot or app token credentials`)
    }
    const botToken = await this.secretsStore.getSecret(binding.commanderId, config.botTokenRef)
    const appToken = await this.secretsStore.getSecret(binding.commanderId, config.appTokenRef)
    if (!botToken || !appToken) {
      throw new Error(`Slack channel "${binding.displayName}" credentials are missing from the encrypted vault`)
    }
    const existing = this.runtimesByAccount.get(binding.accountId)
    if (existing) {
      await this.stop(existing)
    }
    const runtime: SlackRuntime = {
      provider: 'slack',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config,
      accountBinding: binding,
      botToken,
      appToken,
      startedAt: new Date().toISOString(),
      state: 'connecting',
    }
    this.runtimesByAccount.set(binding.accountId, runtime)
    await this.connect(runtime)
    return runtime
  }

  async stop(runtime: ChannelRuntime<SlackChannelConfig>): Promise<void> {
    const slackRuntime = runtime as SlackRuntime
    slackRuntime.state = 'disconnected'
    slackRuntime.socket?.close()
    slackRuntime.socket = undefined
    const active = this.runtimesByAccount.get(slackRuntime.accountId)
    if (!active || active.commanderId === slackRuntime.commanderId) {
      this.runtimesByAccount.delete(slackRuntime.accountId)
    }
  }

  async beginPairing(input: { provider: 'slack'; commanderId: string }) {
    return {
      provider: 'slack' as const,
      commanderId: input.commanderId,
      kind: 'socket-mode-tokens',
      instructions: 'Create the Slack binding by saving the Socket Mode app token and bot token from the Slack app dashboard.',
    }
  }

  async completePairing(): Promise<CommanderChannelBinding> {
    throw new Error('Slack pairing is completed by saving the channel binding')
  }

  async send(
    runtime: ChannelRuntime<SlackChannelConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ) {
    try {
      const binding = await this.resolveBinding(runtime, conversation)
      const config = parseSlackChannelConfig(binding.config, binding.accountId)
      if (!config.botTokenRef) {
        return { success: false as const, error: 'Slack bot token is not configured' }
      }
      const botToken = await this.secretsStore.getSecret(binding.commanderId, config.botTokenRef)
      if (!botToken) {
        return { success: false as const, error: 'Slack bot token is missing from the encrypted vault' }
      }
      const channel = conversation.lastRoute?.to ?? runtime.surfaceBinding?.peerId
      if (!channel) {
        return { success: false as const, error: `No Slack channel id for conversation "${conversation.id}"` }
      }
      const chunks = chunkText(payload.text ?? '', config.maxMessageLength)
      if (chunks.length === 0) {
        return { success: false as const, error: 'Slack outbound text is empty' }
      }
      const responses: unknown[] = []
      for (const text of chunks) {
        responses.push(await this.callSlackApi(botToken, 'chat.postMessage', {
          channel,
          text,
          ...(conversation.lastRoute?.threadId ? { thread_ts: conversation.lastRoute.threadId } : {}),
        }))
      }
      return { success: true as const, rawResponse: responses.length === 1 ? responses[0] : responses }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Failed to send Slack message',
      }
    }
  }

  async checkInboundAllowed(
    runtime: ChannelRuntime<SlackChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<ChannelInboundDecision> {
    const binding = await this.resolveBindingForEvent(runtime, event)
    return this.checkInboundAllowedForBinding(binding, event)
  }

  private checkInboundAllowedForBinding(
    binding: CommanderChannelBinding,
    event: ChannelInboundEvent,
  ): ChannelInboundDecision {
    const config = parseSlackChannelConfig(binding.config, binding.accountId)
    const decision = checkAccountInboundPolicy({ ...binding, config }, event)
    if (!decision.allowed) {
      return decision
    }
    if (event.chatType !== 'direct' && config.requireMention) {
      const metadata = event.metadata?.slack
      const wasMentioned = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).mentionedBot === true
        : false
      return wasMentioned ? decision : { allowed: false, reason: 'mention-required' }
    }
    return decision
  }

  async getStatus(binding: CommanderChannelBinding): Promise<ChannelAdapterStatus> {
    const runtime = this.runtimesByAccount.get(binding.accountId)
    const config = parseSlackChannelConfig(binding.config, binding.accountId)
    return {
      provider: 'slack',
      accountId: binding.accountId,
      transport: 'slack-socket-mode',
      state: binding.enabled ? (runtime?.state ?? 'configured') : 'stopped',
      connected: binding.enabled && config.credentialConfigured && runtime?.state === 'ready',
      ...(runtime?.lastError ? { lastError: runtime.lastError } : {}),
      ...(runtime?.lastEventAt ? { lastEventAt: runtime.lastEventAt } : {}),
      ...(runtime?.lastDrop ? { lastDrop: runtime.lastDrop } : {}),
      metadata: {
        botTokenConfigured: config.botTokenConfigured,
        appTokenConfigured: config.appTokenConfigured,
        ...(config.teamId ? { teamId: config.teamId } : {}),
        ...(config.botUserId ? { botUserId: config.botUserId } : {}),
        ...(runtime?.lastDeniedInbound ? { lastDeniedInbound: runtime.lastDeniedInbound } : {}),
      },
    }
  }

  private async connect(runtime: SlackRuntime): Promise<void> {
    const opened = await this.callSlackApi<{ url?: string }>(runtime.appToken, 'apps.connections.open', {})
    const url = typeof opened.url === 'string' ? opened.url : ''
    if (!url) {
      throw new Error('Slack did not return a Socket Mode WebSocket URL')
    }
    const socket = this.webSocketFactory(url)
    runtime.socket = socket
    socket.on('open', () => {
      runtime.state = 'ready'
      runtime.lastError = undefined
    })
    socket.on('message', (data) => {
      const envelope = parseEnvelope(data as WebSocket.RawData)
      if (envelope) {
        void this.handleEnvelope(runtime, envelope)
      }
    })
    socket.on('close', () => {
      if (runtime.state !== 'disconnected') {
        runtime.state = 'disconnected'
      }
    })
    socket.on('error', (error) => {
      runtime.state = 'error'
      runtime.lastError = error instanceof Error ? error.message : 'Slack Socket Mode error'
      this.logger.warn(`[channels/slack] Socket Mode error for ${runtime.accountId}:`, error)
    })
  }

  private async handleEnvelope(runtime: SlackRuntime, envelope: SlackSocketEnvelope): Promise<void> {
    if (envelope.envelope_id) {
      runtime.socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
    }
    if (envelope.type !== 'events_api' || !isObject(envelope.payload)) {
      return
    }
    const callback = envelope.payload as SlackEventCallback
    const event = callback.event
    if (!event || (event.type !== 'message' && event.type !== 'app_mention')) {
      return
    }
    const inbound = this.eventFromSlackMessage(runtime, callback, event)
    if (!inbound) {
      return
    }
    await this.forwardInbound(inbound)
  }

  private eventFromSlackMessage(
    runtime: SlackRuntime,
    callback: SlackEventCallback,
    event: SlackMessageEvent,
  ): ChannelInboundEvent | null {
    if (!event.channel || !event.ts || event.bot_id || event.subtype === 'bot_message') {
      return null
    }
    const text = event.text?.trim()
    if (!text) {
      return null
    }
    const chatType = chatTypeForSlack(event)
    const threadId = event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : undefined
    const botUserId = runtime.config?.botUserId
      ?? callback.authorizations?.find((authorization) => authorization.user_id)?.user_id
    return {
      provider: 'slack',
      accountId: runtime.accountId,
      chatType,
      peerId: event.channel,
      peerDisplayName: chatType === 'direct' ? event.user ?? event.channel : event.channel,
      ...(callback.team_id ? { groupId: callback.team_id } : {}),
      ...(threadId ? { threadId } : {}),
      text,
      rawTimestamp: event.event_ts ?? event.ts,
      rawSourceId: event.ts,
      metadata: {
        slack: {
          channelType: event.channel_type,
          ...(event.user ? { userId: event.user } : {}),
          ...(callback.team_id ? { teamId: callback.team_id } : {}),
          mentionedBot: chatType === 'direct' || event.type === 'app_mention' || mentionedBot(event, botUserId),
        },
      },
    }
  }

  private async forwardInbound(event: ChannelInboundEvent): Promise<boolean> {
    const runtime = this.runtimesByAccount.get(event.accountId)
    if (!runtime) {
      this.logger.warn(`[channels/slack] Dropped Slack message ${event.rawSourceId}: no runtime for account ${event.accountId}`)
      return false
    }
    let binding: CommanderChannelBinding
    try {
      binding = await this.resolveBindingForEvent(runtime, event)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'binding resolution failed'
      runtime.lastEventAt = new Date().toISOString()
      runtime.lastDrop = buildChannelLastDrop(event, 'binding-resolution', runtime.lastEventAt)
      runtime.lastError = `Slack inbound binding resolution failed: ${message}`
      this.logger.warn(`[channels/slack] Dropped Slack message ${event.rawSourceId}: ${runtime.lastError}`)
      return false
    }
    const decision = this.checkInboundAllowedForBinding(binding, event)
    if (!decision.allowed) {
      this.recordDeniedInbound(runtime, event, decision.reason ?? 'policy-deny')
      return false
    }
    const payload: SlackChannelMessagePayload = {
      provider: 'slack',
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
      runtime.lastEventAt = new Date().toISOString()
      runtime.lastError = `Slack inbound ingest failed: ${response.status}${text ? ` ${text}` : ''}`
      this.logger.warn(`[channels/slack] Failed to ingest Slack message ${event.rawSourceId}: ${response.status} ${text}`)
      return false
    }
    const droppedReason = await readDroppedChannelResponse(response)
    if (droppedReason) {
      this.recordDeniedInbound(runtime, event, droppedReason)
      return false
    }
    runtime.lastEventAt = new Date().toISOString()
    runtime.lastError = undefined
    return true
  }

  private recordDeniedInbound(
    runtime: SlackRuntime,
    event: ChannelInboundEvent,
    reason: string,
  ): void {
    const at = new Date().toISOString()
    runtime.lastEventAt = at
    runtime.lastDrop = buildChannelLastDrop(event, reason, at)
    runtime.lastDeniedInbound = {
      reason,
      at,
      chatType: String(event.chatType),
      peerId: event.peerId,
      rawSourceId: event.rawSourceId,
      ...(event.groupId ? { groupId: event.groupId } : {}),
      ...(event.threadId ? { threadId: event.threadId } : {}),
    }
    this.logger.warn(
      `[channels/slack] Dropped Slack message ${event.rawSourceId}: inbound denied ${reason} (${event.chatType} ${event.peerId})`,
    )
  }

  private postInboundPayload(payload: SlackChannelMessagePayload): Promise<Response> {
    return this.fetchImpl(`${this.apiBaseUrl}/api/commanders/channel-message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-herd-internal-token': this.internalToken,
      },
      body: JSON.stringify(payload),
    })
  }

  private async callSlackApi<T = unknown>(
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<SlackApiResponse<T> & T> {
    const response = await this.fetchImpl(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    })
    const parsed = await response.json().catch(() => null) as SlackApiResponse<T> | null
    if (!response.ok || !parsed?.ok) {
      throw new Error(parsed?.error ?? `Slack ${method} failed with HTTP ${response.status}`)
    }
    return parsed as SlackApiResponse<T> & T
  }

  private async resolveBinding(
    runtime: ChannelRuntime<SlackChannelConfig>,
    conversation: Conversation,
  ): Promise<CommanderChannelBinding> {
    const bindings = await this.bindingStore.listByCommander(conversation.commanderId)
    const binding = bindings.find((candidate) => (
      candidate.provider === 'slack'
      && candidate.accountId === runtime.accountId
      && candidate.enabled
    ))
    if (!binding) {
      throw new Error(`No Slack channel binding for commander "${conversation.commanderId}" and account "${runtime.accountId}"`)
    }
    return binding
  }

  private async resolveBindingForEvent(
    runtime: ChannelRuntime<SlackChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<CommanderChannelBinding> {
    const bindings = (await this.bindingStore.list()).filter((candidate) => (
      candidate.provider === 'slack'
      && candidate.accountId === event.accountId
      && candidate.enabled
    ))
    const binding = bindings.length === 1
      ? bindings[0]
      : bindings.find((candidate) => candidate.commanderId === runtime.commanderId)
    if (!binding) {
      throw new Error(`No unambiguous Slack channel binding for account "${event.accountId}"`)
    }
    return binding
  }
}
