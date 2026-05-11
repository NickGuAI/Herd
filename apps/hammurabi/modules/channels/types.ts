import type { Conversation } from '../commanders/conversation-store.js'

export type SeededChannelProvider =
  | 'whatsapp'
  | 'slack'
  | 'discord'
  | 'email'
  | 'telegram'
  | 'imessage'
  | 'circle'
  | 'matrix'

export type ChannelProvider = SeededChannelProvider | (string & {})
export type CommanderChannelProvider = ChannelProvider

export type ChannelPolicyMode = 'open' | 'allowlist' | 'disabled'

export type ChannelChatType =
  | 'direct'
  | 'group'
  | 'channel'
  | 'forum-topic'
  | 'space'
  | 'post'
  | (string & {})

export type ChannelMarkdownDialect =
  | 'whatsapp'
  | 'slack'
  | 'discord'
  | 'plain'
  | 'html'
  | 'telegram'
  | (string & {})

export interface ChannelCapabilities {
  voiceNotes: boolean
  media: boolean
  threading: boolean
  typingIndicators: boolean
  presence: boolean
  reactions: boolean
  markdownDialect: ChannelMarkdownDialect
}

export interface ChannelAudioInbound {
  buffer: Buffer
  mimeType: string
  durationMs?: number
}

export interface ChannelAudioOutbound {
  buffer: Buffer
  mimeType: string
}

export interface ChannelMediaPayload {
  id?: string
  url?: string
  buffer?: Buffer
  mimeType?: string
  filename?: string
  caption?: string
  metadata?: Record<string, unknown>
}

export interface ChannelInboundEvent {
  provider: ChannelProvider
  accountId: string
  chatType: ChannelChatType
  peerId: string
  peerDisplayName?: string
  groupId?: string
  threadId?: string
  text?: string
  audio?: ChannelAudioInbound
  media?: ChannelMediaPayload[]
  rawTimestamp: string | number
  rawSourceId: string
}

export interface ChannelOutboundPayload {
  text?: string
  audio?: ChannelAudioOutbound
  media?: ChannelMediaPayload[]
  asReplyTo?: string
}

export interface ChannelPairingChallenge {
  provider: ChannelProvider
  kind?: string
  id?: string
  accountId?: string
  expiresAt?: string
  qrCode?: string
  url?: string
  instructions?: string
  metadata?: Record<string, unknown>
}

export interface ChannelPairingInput {
  provider: ChannelProvider
  commanderId: string
  accountId?: string
  displayName?: string
  config?: CommanderChannelBindingConfig
  metadata?: Record<string, unknown>
}

export interface ChannelPairingResponse {
  provider?: ChannelProvider
  kind?: string
  challengeId?: string
  code?: string
  token?: string
  accountId?: string
  displayName?: string
  config?: CommanderChannelBindingConfig
  metadata?: Record<string, unknown>
}

export interface ChannelRuntime<TConfig = unknown> {
  provider: ChannelProvider
  accountId: string
  commanderId?: string
  config?: TConfig
  accountBinding?: CommanderChannelBinding
  surfaceBinding?: ChannelSurfaceBinding
  [key: string]: unknown
}

export type ChannelSendResult =
  | { success: true; rawResponse?: unknown }
  | { success: false; error: string; rawResponse?: unknown }

export type ChannelInboundDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason?: string }

export interface ChannelAdapter<TConfig = unknown> {
  provider: ChannelProvider
  capabilities: ChannelCapabilities
  normalizeInbound?(payload: unknown): ChannelInboundEvent
  start(binding: CommanderChannelBinding): Promise<ChannelRuntime<TConfig>>
  stop(runtime: ChannelRuntime<TConfig>): Promise<void>
  beginPairing(input: ChannelPairingInput): Promise<ChannelPairingChallenge>
  completePairing(
    challenge: ChannelPairingChallenge,
    response: ChannelPairingResponse,
  ): Promise<CommanderChannelBinding>
  send(
    runtime: ChannelRuntime<TConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ): Promise<ChannelSendResult>
  checkInboundAllowed(
    runtime: ChannelRuntime<TConfig>,
    event: ChannelInboundEvent,
  ): Promise<ChannelInboundDecision>
}

export interface ChannelBindingPolicyConfig {
  dmPolicy?: ChannelPolicyMode
  groupPolicy?: ChannelPolicyMode
  dmAllowlist?: string[]
  groupAllowlist?: string[]
  allowlist?: string[]
  requireMention?: boolean
  [key: string]: unknown
}

export interface CommanderChannelBindingConfig extends ChannelBindingPolicyConfig {
  readonly provider?: ChannelProvider
  // Future provider-specific fields must be adapter-only optional members.
  // Core routing code must not read them to choose provider-specific paths.
}

export interface CommanderChannelBinding {
  id: string
  commanderId: string
  provider: CommanderChannelProvider
  accountId: string
  displayName: string
  enabled: boolean
  config: CommanderChannelBindingConfig
  createdAt: string
  updatedAt: string
}

export interface ChannelSurfaceBinding {
  id: string
  provider: ChannelProvider
  accountId: string
  peerId: string
  threadId?: string
  surfaceKey: string
  commanderId: string
  conversationId: string
  enabled: boolean
  config: Record<string, unknown>
  createdAt: string
}
