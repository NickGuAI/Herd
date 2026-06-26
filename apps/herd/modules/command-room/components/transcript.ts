import type { SessionQueueSnapshot } from '@/types'
import type { MsgItem } from '@modules/agents/messages/model'
import { getStableMessageIdentity } from '@modules/agents/messages/stable-message-id'

export interface PendingConversationMessage extends MsgItem {
  conversationId: string
  clientSendId: string
  kind: 'user'
}

export interface PendingConversationMessageInput {
  conversationId?: string | null
  text: string
  images?: MsgItem['images']
  clientSendId?: string
  timestamp?: string
}

interface MergeConversationTranscriptSourcesInput {
  canonicalMessages: MsgItem[]
  liveMessages?: MsgItem[]
  pendingMessages?: PendingConversationMessage[]
  conversationId?: string | null
}

type ConversationTranscriptSource = 'canonical' | 'live' | 'pending'

interface ConversationTranscriptRecord {
  key: string
  message: MsgItem
  source: ConversationTranscriptSource
  insertionIndex: number
  seq: number | null
  timeMs: number | null
}

export function mapSessionMessagesToTranscript(messages: MsgItem[]): MsgItem[] {
  return messages
}

function getConversationTranscriptMessageKey(message: MsgItem): string | null {
  return getStableMessageIdentity(message) ?? (
    message.clientSendId
      ? `client-send:${message.clientSendId}`
      : null
  )
}

function hasDurableLiveAnchor(message: MsgItem): boolean {
  if (message.clientSendId) {
    return true
  }
  const transcript = message.transcript
  return Boolean(
    transcript?.source?.sessionId
    || transcript?.turnId
    || transcript?.itemId
    || transcript?.providerEventId
    || transcript?.envelopeId,
  )
}

function shouldPreferLiveMessage(canonical: MsgItem, live: MsgItem): boolean {
  if (live.kind !== canonical.kind) {
    return true
  }
  if (live.text.length > canonical.text.length) {
    return true
  }
  if ((live.images?.length ?? 0) > (canonical.images?.length ?? 0)) {
    return true
  }
  if (live.children && live.children.length > (canonical.children?.length ?? 0)) {
    return true
  }
  return false
}

function getMessageSeq(message: MsgItem): number | null {
  const seq = message.transcript?.seq
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0
    ? seq
    : null
}

function getMessageTimeMs(message: MsgItem): number | null {
  const rawTime = message.transcript?.time ?? message.timestamp
  if (!rawTime) {
    return null
  }
  const parsed = Date.parse(rawTime)
  return Number.isFinite(parsed) ? parsed : null
}

function hasBetterOrderingMetadata(
  existing: ConversationTranscriptRecord,
  incoming: ConversationTranscriptRecord,
): boolean {
  if (existing.seq === null && incoming.seq !== null) {
    return true
  }
  if (existing.timeMs === null && incoming.timeMs !== null) {
    return true
  }
  return false
}

function shouldReplaceConversationTranscriptRecord(
  existing: ConversationTranscriptRecord,
  incoming: ConversationTranscriptRecord,
): boolean {
  if (existing.source === 'pending' && incoming.source !== 'pending') {
    return true
  }
  if (incoming.source === 'pending') {
    return false
  }
  if (incoming.source === 'live' && existing.source !== 'live') {
    return shouldPreferLiveMessage(existing.message, incoming.message)
      || hasBetterOrderingMetadata(existing, incoming)
  }
  if (incoming.source === existing.source) {
    return shouldPreferLiveMessage(existing.message, incoming.message)
      || hasBetterOrderingMetadata(existing, incoming)
  }
  return false
}

function compareConversationTranscriptRecords(
  left: ConversationTranscriptRecord,
  right: ConversationTranscriptRecord,
): number {
  const leftPendingWithoutSeq = left.source === 'pending' && left.seq === null
  const rightPendingWithoutSeq = right.source === 'pending' && right.seq === null
  if (leftPendingWithoutSeq !== rightPendingWithoutSeq) {
    return leftPendingWithoutSeq ? 1 : -1
  }
  if (left.seq !== null && right.seq !== null && left.seq !== right.seq) {
    return left.seq - right.seq
  }
  if (left.timeMs !== null && right.timeMs !== null && left.timeMs !== right.timeMs) {
    return left.timeMs - right.timeMs
  }
  if (left.seq !== null && right.seq === null) {
    return -1
  }
  if (left.seq === null && right.seq !== null) {
    return 1
  }
  return left.insertionIndex - right.insertionIndex
}

function buildConversationTranscriptRecord(
  message: MsgItem,
  source: ConversationTranscriptSource,
  insertionIndex: number,
): ConversationTranscriptRecord {
  return {
    key: getConversationTranscriptMessageKey(message) ?? `local:${source}:${insertionIndex}`,
    message,
    source,
    insertionIndex,
    seq: getMessageSeq(message),
    timeMs: getMessageTimeMs(message),
  }
}

export function mergeConversationTranscriptSources({
  canonicalMessages,
  liveMessages = [],
  pendingMessages = [],
  conversationId,
}: MergeConversationTranscriptSourcesInput): MsgItem[] {
  const durableLiveMessages = liveMessages.filter(hasDurableLiveAnchor)
  const visiblePendingMessages = getUnconfirmedPendingConversationMessages(
    [...canonicalMessages, ...durableLiveMessages],
    pendingMessages,
    conversationId,
  )
  const recordsByKey = new Map<string, ConversationTranscriptRecord>()
  let insertionIndex = 0
  const addMessages = (
    messages: MsgItem[],
    source: ConversationTranscriptSource,
  ) => {
    for (const message of messages) {
      const incoming = buildConversationTranscriptRecord(message, source, insertionIndex)
      insertionIndex += 1
      const existing = recordsByKey.get(incoming.key)
      if (!existing) {
        recordsByKey.set(incoming.key, incoming)
        continue
      }
      if (shouldReplaceConversationTranscriptRecord(existing, incoming)) {
        recordsByKey.set(incoming.key, {
          ...incoming,
          insertionIndex: existing.insertionIndex,
        })
      }
    }
  }

  addMessages(canonicalMessages, 'canonical')
  addMessages(durableLiveMessages, 'live')
  addMessages(visiblePendingMessages, 'pending')

  return [...recordsByKey.values()]
    .sort(compareConversationTranscriptRecords)
    .map((record) => record.message)
}

export function mergeConversationLiveTranscript(
  canonicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): MsgItem[] {
  if (liveMessages.length === 0) {
    return canonicalMessages
  }
  if (!liveMessages.some(hasDurableLiveAnchor)) {
    return canonicalMessages
  }

  return mergeConversationTranscriptSources({
    canonicalMessages,
    liveMessages,
  })
}

export function appendQueuedMessagesToTranscript(
  messages: MsgItem[],
  _queueSnapshot?: SessionQueueSnapshot | null,
): MsgItem[] {
  return messages
}

function normalizeNonEmpty(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function createPendingConversationMessage({
  conversationId,
  text,
  images,
  clientSendId,
  timestamp,
}: PendingConversationMessageInput): PendingConversationMessage | null {
  const safeConversationId = normalizeNonEmpty(conversationId)
  const safeClientSendId = normalizeNonEmpty(clientSendId)
  if (!safeConversationId || !safeClientSendId) {
    return null
  }

  return {
    id: `pending-conversation-${safeConversationId}-${safeClientSendId}`,
    conversationId: safeConversationId,
    kind: 'user',
    text: text.trim() || '[image]',
    ...(images && images.length > 0 ? { images } : {}),
    clientSendId: safeClientSendId,
    ...(timestamp ? { timestamp } : {}),
  }
}

function getCanonicalClientSendIds(canonicalMessages: MsgItem[]): Set<string> {
  return new Set(
    canonicalMessages
      .filter((message) => message.kind === 'user')
      .map((message) => normalizeNonEmpty(message.clientSendId))
      .filter((clientSendId): clientSendId is string => Boolean(clientSendId)),
  )
}

export function getUnconfirmedPendingConversationMessages(
  canonicalMessages: MsgItem[],
  pendingMessages: PendingConversationMessage[],
  conversationId?: string | null,
): MsgItem[] {
  const safeConversationId = normalizeNonEmpty(conversationId)
  if (!safeConversationId || pendingMessages.length === 0) {
    return []
  }

  const confirmedClientSendIds = getCanonicalClientSendIds(canonicalMessages)
  return pendingMessages.filter((message) => (
    message.conversationId === safeConversationId
    && !confirmedClientSendIds.has(message.clientSendId)
  ))
}

export function hasPendingConversationMessages(
  canonicalMessages: MsgItem[],
  pendingMessages: PendingConversationMessage[],
  conversationId?: string | null,
): boolean {
  return getUnconfirmedPendingConversationMessages(
    canonicalMessages,
    pendingMessages,
    conversationId,
  ).length > 0
}

export function appendPendingConversationMessagesToTranscript(
  canonicalMessages: MsgItem[],
  pendingMessages: PendingConversationMessage[],
  conversationId?: string | null,
): MsgItem[] {
  const visiblePendingMessages = getUnconfirmedPendingConversationMessages(
    canonicalMessages,
    pendingMessages,
    conversationId,
  )
  if (visiblePendingMessages.length === 0) {
    return canonicalMessages
  }

  return mergeConversationTranscriptSources({
    canonicalMessages,
    pendingMessages,
    conversationId,
  })
}

export function pruneConfirmedPendingConversationMessages(
  pendingMessages: PendingConversationMessage[],
  canonicalMessages: MsgItem[],
  conversationId?: string | null,
): PendingConversationMessage[] {
  const safeConversationId = normalizeNonEmpty(conversationId)
  if (!safeConversationId || pendingMessages.length === 0) {
    return pendingMessages
  }

  const confirmedClientSendIds = getCanonicalClientSendIds(canonicalMessages)
  if (confirmedClientSendIds.size === 0) {
    return pendingMessages
  }

  return pendingMessages.filter((message) => (
    message.conversationId !== safeConversationId
    || !confirmedClientSendIds.has(message.clientSendId)
  ))
}
