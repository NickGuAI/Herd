import type { SessionQueueSnapshot } from '@/types'
import { describe, expect, it } from 'vitest'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  appendQueuedMessagesToTranscript,
  mapSessionMessagesToTranscript,
  mergeHistoricalAndLiveTranscript,
} from '../components/transcript'

describe('mapSessionMessagesToTranscript', () => {
  it('preserves the rich MsgItem transcript shape for Hervald rendering parity', () => {
    const messages = [
      {
        id: 'user-1',
        kind: 'user',
        text: 'Brief the fleet',
        timestamp: '2026-04-19T12:00:00.000Z',
      },
      {
        id: 'agent-1',
        kind: 'agent',
        text: 'Fleet brief ready.',
      },
      {
        id: 'tool-1',
        kind: 'tool',
        text: 'Bash',
      },
      {
        id: 'plan-1',
        kind: 'planning',
        text: '1. Inspect\n2. Report',
      },
    ]

    expect(mapSessionMessagesToTranscript(messages)).toEqual(messages)
  })
})

describe('mergeHistoricalAndLiveTranscript', () => {
  it('drops only replayed historical messages when live messages overlap', () => {
    const historicalMessages: MsgItem[] = [
      { id: 'history-1', kind: 'agent', text: 'same' },
      { id: 'history-2', kind: 'agent', text: 'older' },
      { id: 'history-3', kind: 'agent', text: 'same' },
    ]
    const liveMessages: MsgItem[] = [
      { id: 'live-1', kind: 'agent', text: 'same' },
      { id: 'live-2', kind: 'agent', text: 'newer' },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      { id: 'history-1', kind: 'agent', text: 'same' },
      { id: 'history-2', kind: 'agent', text: 'older' },
      { id: 'live-1', kind: 'agent', text: 'same' },
      { id: 'live-2', kind: 'agent', text: 'newer' },
    ])
  })
})

describe('appendQueuedMessagesToTranscript', () => {
  it('keeps queued backlog items out of the chat transcript', () => {
    const messages: MsgItem[] = [
      { id: 'agent-1', kind: 'agent', text: 'Working.' },
    ]
    const queueSnapshot: SessionQueueSnapshot = {
      currentMessage: null,
      totalCount: 1,
      items: [
        {
          id: 'queue-1',
          text: 'Do this next.',
          priority: 'normal',
          queuedAt: '2026-05-17T14:00:00.000Z',
        },
      ],
    }

    expect(appendQueuedMessagesToTranscript(messages, queueSnapshot)).toEqual([
      { id: 'agent-1', kind: 'agent', text: 'Working.' },
    ])
  })

  it('keeps the current queued message out of the chat transcript', () => {
    const queueSnapshot: SessionQueueSnapshot = {
      currentMessage: {
        id: 'queue-current',
        text: 'Current queued turn.',
        priority: 'normal',
        queuedAt: '2026-05-17T14:01:00.000Z',
      },
      totalCount: 1,
      items: [],
    }

    expect(appendQueuedMessagesToTranscript([], queueSnapshot)).toEqual([])

    expect(appendQueuedMessagesToTranscript([
      { id: 'live-user', kind: 'user', text: 'Current queued turn.' },
    ], queueSnapshot)).toEqual([
      { id: 'live-user', kind: 'user', text: 'Current queued turn.' },
    ])
  })
})
