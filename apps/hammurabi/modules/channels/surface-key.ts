import type { ChannelInboundEvent } from './types.js'

function clean(value: string | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

export function computeChannelSurfaceKey(event: Pick<
  ChannelInboundEvent,
  'provider' | 'accountId' | 'peerId' | 'threadId'
>): string {
  return getSurfaceKey(event)
}

export function getSurfaceKey(event: Pick<
  ChannelInboundEvent,
  'provider' | 'accountId' | 'peerId' | 'threadId'
>): string {
  const provider = clean(event.provider) ?? 'unknown'
  const accountId = clean(event.accountId) ?? 'default'
  const peerId = clean(event.peerId) ?? 'unknown'
  const threadId = clean(event.threadId)

  return threadId
    ? `${provider}:${accountId}:${peerId}:${threadId}`
    : `${provider}:${accountId}:${peerId}`
}
