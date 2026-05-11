import { describe, expect, it } from 'vitest'
import type { MsgItem } from '@modules/agents/messages/model'
import {
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
