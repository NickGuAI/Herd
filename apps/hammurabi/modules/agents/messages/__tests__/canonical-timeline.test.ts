import { describe, expect, it } from 'vitest'
import type { TranscriptEnvelope } from '../../../../src/types/transcript-envelope'
import type { StreamJsonEvent } from '../../types'
import {
  getNextStreamEventSeq,
  mergeCanonicalStreamEvents,
  stampStreamEventSeq,
} from '../canonical-timeline'

function unsequencedUser(text: string, clientSendId?: string, timestamp?: string): StreamJsonEvent {
  return {
    type: 'user',
    ...(clientSendId ? { clientSendId } : {}),
    ...(timestamp ? { timestamp } : {}),
    message: { role: 'user', content: text },
  } as unknown as StreamJsonEvent
}

function codexEnvelope(input: {
  id: string
  itemId: string
  seq?: number
  text?: string
  time?: string
  clientSendId?: string
  ev?: TranscriptEnvelope['ev']
}): StreamJsonEvent {
  return {
    schemaVersion: 2,
    id: input.id,
    time: input.time ?? '2026-06-14T12:00:00.000Z',
    source: {
      provider: 'codex',
      backend: 'rpc',
      sessionId: 'thread-1',
      rawEventType: 'hammurabi/user',
      rawEventId: input.itemId,
    },
    itemId: input.itemId,
    ...(input.clientSendId ? { clientSendId: input.clientSendId } : {}),
    ...(input.seq ? { seq: input.seq } : {}),
    ev: input.ev ?? {
      type: 'message.delta',
      text: input.text ?? input.itemId,
      channel: 'final',
    },
  } satisfies TranscriptEnvelope
}

describe('canonical timeline helpers', () => {
  it('stamps appended events with the next monotonic seq', () => {
    const first = unsequencedUser('first')
    stampStreamEventSeq(first, 3)

    expect(first).toEqual(expect.objectContaining({ seq: 3 }))
    expect(getNextStreamEventSeq([unsequencedUser('unsequenced'), first])).toBe(4)
  })

  it('dedupes persisted and live events by durable seq and orders by seq', () => {
    const persistedOne = codexEnvelope({ id: 'persisted-1', itemId: 'item-1', seq: 1, text: 'old one' })
    const persistedTwo = codexEnvelope({ id: 'persisted-2', itemId: 'item-2', seq: 2, text: 'two' })
    const liveOne = codexEnvelope({ id: 'live-1', itemId: 'item-1-live', seq: 1, text: 'new one' })

    expect(mergeCanonicalStreamEvents({
      persistedEvents: [persistedTwo, persistedOne],
      liveEvents: [liveOne],
    })).toEqual([liveOne, persistedTwo])
  })

  it('uses clientSendId as the durable identity before sequence for user records', () => {
    const persistedUser = {
      ...codexEnvelope({ id: 'persisted-user', itemId: 'user-item', seq: 4, text: 'old echo' }),
      clientSendId: 'send-1',
    }
    const liveUser = {
      ...codexEnvelope({ id: 'live-user', itemId: 'user-item-live', seq: 5, text: 'new echo' }),
      clientSendId: 'send-1',
    }

    expect(mergeCanonicalStreamEvents({
      persistedEvents: [persistedUser],
      liveEvents: [liveUser],
    })).toEqual([liveUser])
  })

  it('preserves all unsequenced v2 user envelope fragments for one client send', () => {
    const clientSendId = 'send-with-image'
    const start = codexEnvelope({
      id: 'start',
      itemId: clientSendId,
      clientSendId,
      ev: { type: 'message.start', role: 'user' },
    })
    const delta = codexEnvelope({
      id: 'delta',
      itemId: clientSendId,
      clientSendId,
      ev: { type: 'message.delta', text: 'review this', channel: 'final' },
    })
    const image = codexEnvelope({
      id: 'image',
      itemId: clientSendId,
      clientSendId,
      ev: {
        type: 'message.image',
        role: 'user',
        image: {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
        },
      },
    })
    const end = codexEnvelope({
      id: 'end',
      itemId: clientSendId,
      clientSendId,
      ev: { type: 'message.end' },
    })

    expect(mergeCanonicalStreamEvents({
      persistedEvents: [],
      liveEvents: [start, delta, image, end],
    })).toEqual([start, delta, image, end])
  })

  it('keeps older unsequenced history before newer sequenced events when timestamps exist', () => {
    const sequenced = codexEnvelope({
      id: 'sequenced',
      itemId: 'item-1',
      seq: 1,
      time: '2026-06-14T12:00:00.000Z',
    })
    const unsequenced = unsequencedUser('pre-seq', undefined, '2026-06-14T11:00:00.000Z')

    expect(mergeCanonicalStreamEvents({
      persistedEvents: [unsequenced, sequenced],
    })).toEqual([unsequenced, sequenced])
  })

  it('ignores non-envelope live rows and preserves repeated unkeyed persisted rows', () => {
    const repeated = unsequencedUser('same text')
    const repeatedAgain = unsequencedUser('same text')
    const liveUser = unsequencedUser('new draft', 'send-1')

    expect(mergeCanonicalStreamEvents({
      persistedEvents: [repeated, repeatedAgain],
      liveEvents: [liveUser],
    })).toEqual([repeated, repeatedAgain])
  })
})
