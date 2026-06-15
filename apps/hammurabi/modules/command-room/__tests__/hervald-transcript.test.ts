import type { SessionQueueSnapshot } from '@/types'
import { describe, expect, it } from 'vitest'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  appendPendingOptimisticMessagesToTranscript,
  appendQueuedMessagesToTranscript,
  hasPendingOptimisticMessages,
  mapSessionMessagesToTranscript,
} from '../components/transcript'

describe('mapSessionMessagesToTranscript', () => {
  it('preserves the rich MsgItem transcript shape for Herd rendering parity', () => {
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

describe('appendPendingOptimisticMessagesToTranscript', () => {
  it('appends pending optimistic user sends after the canonical page', () => {
    const clientSendId = 'conversation-image-send-1705'
    const canonicalMessages: MsgItem[] = [
      {
        id: 'history-agent',
        kind: 'agent',
        text: 'Previous reply',
        transcript: { seq: 1, source: { provider: 'codex', backend: 'rpc' } },
      },
      {
        id: 'history-provider',
        kind: 'provider',
        text: 'Codex turn started',
        transcript: { seq: 2, source: { provider: 'codex', backend: 'rpc' } },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'optimistic-user',
        kind: 'user',
        text: 'Run tests',
        clientSendId,
      },
    ]

    expect(appendPendingOptimisticMessagesToTranscript(canonicalMessages, liveMessages)).toEqual([
      canonicalMessages[0],
      canonicalMessages[1],
      liveMessages[0],
    ])
    expect(hasPendingOptimisticMessages(canonicalMessages, liveMessages)).toBe(true)
  })

  it('drops optimistic sends once the canonical page contains the clientSendId', () => {
    const clientSendId = 'send-1'
    const canonicalMessages: MsgItem[] = [
      {
        id: 'history-user',
        kind: 'user',
        text: 'Run tests',
        clientSendId,
        transcript: { seq: 1, source: { provider: 'codex', backend: 'rpc' } },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'optimistic-user',
        kind: 'user',
        text: 'Run tests',
        clientSendId,
      },
    ]

    expect(appendPendingOptimisticMessagesToTranscript(canonicalMessages, liveMessages)).toEqual(canonicalMessages)
    expect(hasPendingOptimisticMessages(canonicalMessages, liveMessages)).toBe(false)
  })

  it('ignores sequenced live backend rows until they arrive through the canonical page', () => {
    const canonicalMessages: MsgItem[] = [
      {
        id: 'history-provider',
        kind: 'provider',
        text: 'Turn started',
        transcript: { seq: 2, source: { provider: 'codex', backend: 'rpc' } },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-user',
        kind: 'user',
        text: 'Run tests',
        clientSendId: 'send-1',
        transcript: { seq: 1, source: { provider: 'codex', backend: 'rpc' } },
      },
    ]

    expect(appendPendingOptimisticMessagesToTranscript(canonicalMessages, liveMessages)).toEqual(canonicalMessages)
  })

  it('does not content-dedupe or append unkeyed live rows', () => {
    const canonicalMessages: MsgItem[] = [
      {
        id: 'history-agent',
        kind: 'agent',
        text: 'same',
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-agent',
        kind: 'agent',
        text: 'same',
      },
    ]

    expect(appendPendingOptimisticMessagesToTranscript(canonicalMessages, liveMessages)).toEqual(canonicalMessages)
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
