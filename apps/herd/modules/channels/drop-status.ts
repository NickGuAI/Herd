import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChannelInboundEvent, ChannelLastDrop } from './types.js'

const RECENT_DROP_LIMIT = 20

export interface ChannelDropStatus {
  dropCount: number
  recentDrops: ChannelLastDrop[]
  lastDrop?: ChannelLastDrop
}

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

function dropFateForReason(reason: string): NonNullable<ChannelLastDrop['fate']> {
  const normalized = reason.trim().toLowerCase()
  return normalized.includes('allowlist') ||
    normalized.includes('policy') ||
    normalized.includes('disabled') ||
    normalized.includes('mention')
    ? 'policy-denied'
    : 'ingest-failed'
}

export function buildChannelLastDrop(
  event: ChannelInboundEvent,
  reason: string,
  at = new Date().toISOString(),
  detail?: string,
): ChannelLastDrop {
  return {
    fate: dropFateForReason(reason),
    reason,
    at,
    chatType: String(event.chatType),
    sourceHash: hashChannelDropSource(event.provider, event.accountId, event.rawSourceId),
    ...(detail?.trim() ? { detail: detail.trim().slice(0, 500) } : {}),
  }
}

function safePathToken(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 24)
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').slice(0, 80)
  return normalized ? `${normalized}-${digest}` : digest
}

function parseDrop(raw: unknown): ChannelLastDrop | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const input = raw as Record<string, unknown>
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : ''
  const at = typeof input.at === 'string' && input.at.trim() ? input.at.trim() : ''
  if (!reason || !at) {
    return null
  }
  const fate = input.fate === 'policy-denied' || input.fate === 'ingest-failed'
    ? input.fate
    : dropFateForReason(reason)
  return {
    fate,
    reason,
    at,
    ...(typeof input.chatType === 'string' && input.chatType.trim() ? { chatType: input.chatType.trim() } : {}),
    ...(typeof input.sourceHash === 'string' && input.sourceHash.trim() ? { sourceHash: input.sourceHash.trim() } : {}),
    ...(typeof input.detail === 'string' && input.detail.trim() ? { detail: input.detail.trim() } : {}),
  }
}

function parseDropStatus(raw: unknown): ChannelDropStatus {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { dropCount: 0, recentDrops: [] }
  }
  const input = raw as Record<string, unknown>
  const recentDrops = Array.isArray(input.recentDrops)
    ? input.recentDrops.map(parseDrop).filter((drop): drop is ChannelLastDrop => Boolean(drop))
    : []
  const dropCount = typeof input.dropCount === 'number' && Number.isFinite(input.dropCount)
    ? Math.max(recentDrops.length, Math.floor(input.dropCount))
    : recentDrops.length
  return {
    dropCount,
    recentDrops,
    ...(recentDrops[0] ? { lastDrop: recentDrops[0] } : {}),
  }
}

export class ChannelDropStatusStore {
  private readonly rootDir: string

  constructor(dataDir: string) {
    this.rootDir = path.join(path.resolve(dataDir), 'channels', 'drops')
  }

  private statusPath(provider: string, accountId: string): string {
    return path.join(
      this.rootDir,
      safePathToken(provider.trim().toLowerCase()),
      `${safePathToken(accountId)}.json`,
    )
  }

  async read(provider: string, accountId: string): Promise<ChannelDropStatus> {
    try {
      const raw = await readFile(this.statusPath(provider, accountId), 'utf8')
      return parseDropStatus(JSON.parse(raw))
    } catch {
      return { dropCount: 0, recentDrops: [] }
    }
  }

  async record(event: ChannelInboundEvent, reason: string, detail?: string): Promise<ChannelDropStatus> {
    const drop = buildChannelLastDrop(event, reason, new Date().toISOString(), detail)
    const current = await this.read(event.provider, event.accountId)
    const next: ChannelDropStatus = {
      dropCount: current.dropCount + 1,
      recentDrops: [drop, ...current.recentDrops].slice(0, RECENT_DROP_LIMIT),
      lastDrop: drop,
    }
    const filePath = this.statusPath(event.provider, event.accountId)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(`${filePath}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(`${filePath}.tmp`, filePath)
    return next
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
