import { isTranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import type { StreamJsonEvent } from '../types.js'

interface CanonicalEventRecord {
  event: StreamJsonEvent
  key: string
  durable: boolean
  seq: number | null
  timeMs: number | null
  sourceRank: number
  index: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

export function readStreamEventSeq(event: StreamJsonEvent): number | null {
  const seq = isTranscriptEnvelope(event)
    ? event.seq
    : asRecord(event)?.seq
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0
    ? seq
    : null
}

export function getNextStreamEventSeq(events: readonly StreamJsonEvent[]): number {
  let maxSeq = 0
  for (const event of events) {
    const seq = readStreamEventSeq(event)
    if (seq !== null && seq > maxSeq) {
      maxSeq = seq
    }
  }
  return maxSeq + 1
}

export function stampStreamEventSeq(event: StreamJsonEvent, seq: number): StreamJsonEvent {
  (event as StreamJsonEvent & { seq?: number }).seq = seq
  return event
}

function readEventTimeMs(event: StreamJsonEvent): number | null {
  const record = asRecord(event)
  const rawTime = isTranscriptEnvelope(event)
    ? event.time
    : readTrimmedString(record?.timestamp)
  if (!rawTime) {
    return null
  }
  const parsed = Date.parse(rawTime)
  return Number.isFinite(parsed) ? parsed : null
}

function readLegacyUserClientSendId(event: StreamJsonEvent): string | undefined {
  const record = asRecord(event)
  if (record?.type !== 'user') {
    return undefined
  }
  return readTrimmedString(record.clientSendId)
}

function durableEventKey(event: StreamJsonEvent): string | null {
  if (!isTranscriptEnvelope(event)) {
    const clientSendId = readLegacyUserClientSendId(event)
    return clientSendId
      ? `user:${clientSendId}`
      : null
  }

  const clientSendId = readTrimmedString(event.clientSendId)
  if (clientSendId && event.ev.type !== 'message.image') {
    return `user:${clientSendId}:${event.ev.type}`
  }

  const envelopeId = readTrimmedString(event.id)
  if (envelopeId) {
    return `envelope:${envelopeId}`
  }

  const seq = readStreamEventSeq(event)
  if (seq !== null) {
    return [
      'seq',
      event.source.provider,
      event.source.backend,
      event.source.sessionId ?? '',
      event.time,
      event.ev.type,
      seq,
    ].join(':')
  }

  const source = event.source
  return [
    'envelope',
    source.provider,
    source.backend,
    source.sessionId ?? '',
    event.turnId ?? '',
    event.itemId ?? '',
    event.parentId ?? '',
    event.subagentId ?? '',
    event.ev.type,
    event.id,
  ].join(':')
}

function buildRecord(
  event: StreamJsonEvent,
  sourceRank: number,
  index: number,
): CanonicalEventRecord {
  const durable = durableEventKey(event)
  return {
    event,
    key: durable ?? `source:${sourceRank}:${index}`,
    durable: durable !== null,
    seq: readStreamEventSeq(event),
    timeMs: readEventTimeMs(event),
    sourceRank,
    index,
  }
}

function compareCanonicalEventRecords(left: CanonicalEventRecord, right: CanonicalEventRecord): number {
  if (left.timeMs !== null && right.timeMs !== null && left.timeMs !== right.timeMs) {
    return left.timeMs - right.timeMs
  }
  if (left.seq !== null && right.seq !== null && left.seq !== right.seq) {
    return left.seq - right.seq
  }
  if (left.seq !== null && right.seq === null) {
    return -1
  }
  if (left.seq === null && right.seq !== null) {
    return 1
  }
  if (left.sourceRank !== right.sourceRank) {
    return left.sourceRank - right.sourceRank
  }
  return left.index - right.index
}

export function mergeCanonicalStreamEvents(input: {
  persistedEvents: readonly StreamJsonEvent[]
  liveEvents?: readonly StreamJsonEvent[]
}): StreamJsonEvent[] {
  const recordsByDurableKey = new Map<string, CanonicalEventRecord>()
  const records: CanonicalEventRecord[] = []

  const addEvents = (events: readonly StreamJsonEvent[], sourceRank: number) => {
    for (const [index, event] of events.entries()) {
      if (sourceRank > 0 && !isTranscriptEnvelope(event)) {
        continue
      }
      const record = buildRecord(event, sourceRank, index)
      if (!record.durable) {
        records.push(record)
        continue
      }
      const existing = recordsByDurableKey.get(record.key)
      if (!existing || record.sourceRank >= existing.sourceRank) {
        recordsByDurableKey.set(record.key, record)
      }
    }
  }

  addEvents(input.persistedEvents, 0)
  addEvents(input.liveEvents ?? [], 1)

  return [
    ...records,
    ...recordsByDurableKey.values(),
  ]
    .sort(compareCanonicalEventRecords)
    .map((record) => record.event)
}
