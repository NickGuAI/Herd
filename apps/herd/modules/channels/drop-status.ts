import { createHash } from 'node:crypto'
import type { ChannelInboundEvent, ChannelLastDrop } from './types.js'

export function hashChannelDropSource(
  provider: string,
  accountId: string,
  rawSourceId: string,
): string {
  return createHash('sha256')
    .update([provider, accountId, rawSourceId].join('\0'))
    .digest('hex')
    .slice(0, 16)
}

export function buildChannelLastDrop(
  event: ChannelInboundEvent,
  reason: string,
  at = new Date().toISOString(),
): ChannelLastDrop {
  return {
    reason,
    at,
    chatType: String(event.chatType),
    sourceHash: hashChannelDropSource(event.provider, event.accountId, event.rawSourceId),
  }
}

export async function readDroppedChannelResponse(response: Response): Promise<string | null> {
  try {
    const parsed = await response.clone().json() as { dropped?: unknown; reason?: unknown } | null
    return parsed?.dropped === true && typeof parsed.reason === 'string'
      ? parsed.reason
      : null
  } catch {
    return null
  }
}
