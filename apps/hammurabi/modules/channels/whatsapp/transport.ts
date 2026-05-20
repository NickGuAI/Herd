import type {
  ChannelInboundEvent,
  ChannelOutboundPayload,
} from '../types.js'
import type { WhatsAppChannelConfig } from './config.js'

export type WhatsAppConnectionState =
  | 'starting'
  | 'pairing'
  | 'connected'
  | 'disconnected'
  | 'logged-out'
  | 'error'
  | 'stopped'

export interface WhatsAppRuntimeStatus {
  provider: 'whatsapp'
  accountId: string
  transport: string
  state: WhatsAppConnectionState
  connected: boolean
  lastQrAt?: string
  lastError?: string
  lastEventAt?: string
  qrCode?: string
  qrDataUrl?: string
}

export interface WhatsAppPairingSession {
  challengeId: string
  accountId: string
  expiresAt: string
  runtime: WhatsAppTransportRuntime
  qrCode?: string
  qrDataUrl?: string
  status: WhatsAppRuntimeStatus
}

export interface WhatsAppTransportRuntime {
  accountId: string
  status(): WhatsAppRuntimeStatus
  send(peerId: string, payload: ChannelOutboundPayload, options?: { sendTextWithVoiceNote?: boolean }): Promise<void>
  stop(): Promise<void>
}

export interface WhatsAppTransportHandlers {
  onInbound(event: ChannelInboundEvent): Promise<void> | void
  onStatus?(status: WhatsAppRuntimeStatus): Promise<void> | void
}

export interface WhatsAppTransport {
  kind: string
  start(input: {
    accountId: string
    config: WhatsAppChannelConfig
    handlers: WhatsAppTransportHandlers
  }): Promise<WhatsAppTransportRuntime>
  beginPairing(input: {
    challengeId: string
    accountId: string
    config: WhatsAppChannelConfig
    handlers: WhatsAppTransportHandlers
  }): Promise<WhatsAppPairingSession>
}
