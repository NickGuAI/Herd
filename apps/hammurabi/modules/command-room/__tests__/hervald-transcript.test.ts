import type { SessionQueueSnapshot } from '@/types'
import { describe, expect, it } from 'vitest'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  appendPendingConversationMessagesToTranscript,
  appendQueuedMessagesToTranscript,
  createPendingConversationMessage,
  getUnconfirmedPendingConversationMessages,
  hasPendingConversationMessages,
  mapSessionMessagesToTranscript,
  mergeConversationLiveTranscript,
  mergeConversationTranscriptSources,
  pruneConfirmedPendingConversationMessages,
  type PendingConversationMessage,
} from '../components/transcript'

describe('mapSessionMessagesToTranscript', () => {
  it('preserves the rich MsgItem transcript shape for standalone stream rendering parity', () => {
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

describe('conversation pending-send overlay', () => {
  it('creates explicit conversation-scoped pending user messages keyed by clientSendId', () => {
    expect(createPendingConversationMessage({
      conversationId: 'conv-1',
      text: '  Run tests  ',
      images: [{ mediaType: 'image/png', data: 'image-data' }],
      clientSendId: ' send-1 ',
      timestamp: '2026-06-15T00:00:00.000Z',
    })).toEqual({
      id: 'pending-conversation-conv-1-send-1',
      conversationId: 'conv-1',
      kind: 'user',
      text: 'Run tests',
      images: [{ mediaType: 'image/png', data: 'image-data' }],
      clientSendId: 'send-1',
      timestamp: '2026-06-15T00:00:00.000Z',
    })

    expect(createPendingConversationMessage({
      conversationId: 'conv-1',
      text: '',
      clientSendId: undefined,
    })).toBeNull()
  })

  it('appends pending sends after the canonical page while stale pages have not confirmed them', () => {
    const pending = createPendingConversationMessage({
      conversationId: 'conv-1',
      text: 'Run tests',
      clientSendId: 'send-1',
    })
    if (!pending) {
      throw new Error('expected pending message')
    }
    const canonicalMessages: MsgItem[] = [
      {
        id: 'history-agent',
        kind: 'agent',
        text: 'Previous reply',
        transcript: { seq: 1, source: { provider: 'codex', backend: 'rpc' } },
      },
    ]

    expect(appendPendingConversationMessagesToTranscript(
      canonicalMessages,
      [pending],
      'conv-1',
    )).toEqual([
      canonicalMessages[0],
      pending,
    ])
    expect(hasPendingConversationMessages(canonicalMessages, [pending], 'conv-1')).toBe(true)
  })

  it('keeps pending sends through stale canonical pages without the matching clientSendId', () => {
    const pending = createPendingConversationMessage({
      conversationId: 'conv-1',
      text: 'Send me now',
      clientSendId: 'send-stale-page',
    })
    if (!pending) {
      throw new Error('expected pending message')
    }
    const staleCanonicalMessages: MsgItem[] = [
      { id: 'old-user', kind: 'user', text: 'older prompt', clientSendId: 'send-old' },
      { id: 'old-agent', kind: 'agent', text: 'older reply' },
    ]

    expect(getUnconfirmedPendingConversationMessages(
      staleCanonicalMessages,
      [pending],
      'conv-1',
    )).toEqual([pending])
    expect(pruneConfirmedPendingConversationMessages(
      [pending],
      staleCanonicalMessages,
      'conv-1',
    )).toEqual([pending])
  })

  it('drops pending sends once the canonical page contains the matching clientSendId', () => {
    const pending = createPendingConversationMessage({
      conversationId: 'conv-1',
      text: 'Run tests',
      clientSendId: 'send-1',
    })
    if (!pending) {
      throw new Error('expected pending message')
    }
    const canonicalMessages: MsgItem[] = [
      {
        id: 'history-user',
        kind: 'user',
        text: 'Run tests',
        clientSendId: 'send-1',
        transcript: { seq: 1, source: { provider: 'codex', backend: 'rpc' } },
      },
    ]

    expect(appendPendingConversationMessagesToTranscript(
      canonicalMessages,
      [pending],
      'conv-1',
    )).toEqual(canonicalMessages)
    expect(hasPendingConversationMessages(canonicalMessages, [pending], 'conv-1')).toBe(false)
    expect(pruneConfirmedPendingConversationMessages([pending], canonicalMessages, 'conv-1')).toEqual([])
  })

  it('only displays pending sends for the selected conversation', () => {
    const selectedPending = createPendingConversationMessage({
      conversationId: 'conv-selected',
      text: 'Selected send',
      clientSendId: 'send-selected',
    })
    const otherPending = createPendingConversationMessage({
      conversationId: 'conv-other',
      text: 'Other send',
      clientSendId: 'send-other',
    })
    if (!selectedPending || !otherPending) {
      throw new Error('expected pending messages')
    }

    expect(appendPendingConversationMessagesToTranscript(
      [],
      [selectedPending, otherPending],
      'conv-selected',
    )).toEqual([selectedPending])
  })

  it('prunes confirmed sends without deleting other conversation pending sends', () => {
    const confirmed = createPendingConversationMessage({
      conversationId: 'conv-1',
      text: 'Confirmed',
      clientSendId: 'send-confirmed',
    })
    const stillPending = createPendingConversationMessage({
      conversationId: 'conv-1',
      text: 'Still pending',
      clientSendId: 'send-still-pending',
    })
    const otherConversation = createPendingConversationMessage({
      conversationId: 'conv-2',
      text: 'Other conversation',
      clientSendId: 'send-other',
    })
    if (!confirmed || !stillPending || !otherConversation) {
      throw new Error('expected pending messages')
    }
    const pendingMessages: PendingConversationMessage[] = [confirmed, stillPending, otherConversation]
    const canonicalMessages: MsgItem[] = [
      { id: 'canonical-confirmed', kind: 'user', text: 'Confirmed', clientSendId: 'send-confirmed' },
    ]

    expect(pruneConfirmedPendingConversationMessages(
      pendingMessages,
      canonicalMessages,
      'conv-1',
    )).toEqual([stillPending, otherConversation])
  })
})

describe('conversation live transcript reconciliation', () => {
  it('renders live selected-conversation replies before the canonical page catches up', () => {
    const canonicalMessages: MsgItem[] = [
      {
        id: 'hist-user-stale',
        kind: 'user',
        text: 'Run the check',
        clientSendId: 'send-live-1',
        transcript: {
          source: { provider: 'codex', backend: 'rpc', sessionId: 'thread-1' },
          itemId: 'send-live-1',
        },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-user',
        kind: 'user',
        text: 'Run the check',
        clientSendId: 'send-live-1',
        transcript: {
          source: { provider: 'codex', backend: 'rpc', sessionId: 'thread-1' },
          itemId: 'send-live-1',
        },
      },
      {
        id: 'live-agent',
        kind: 'agent',
        text: 'The live answer is ready.',
        transcript: {
          source: { provider: 'codex', backend: 'rpc', sessionId: 'thread-1' },
          turnId: 'turn-live-1',
          itemId: 'msg-live-answer',
        },
      },
    ]

    expect(mergeConversationLiveTranscript(canonicalMessages, liveMessages)).toEqual([
      canonicalMessages[0],
      liveMessages[1],
    ])
  })

  it('uses live user echoes to confirm pending sends while canonical history is stale', () => {
    const pending = createPendingConversationMessage({
      conversationId: 'conv-live',
      text: 'Run the check',
      clientSendId: 'send-live-confirmed',
    })
    if (!pending) {
      throw new Error('expected pending message')
    }
    const canonicalMessages: MsgItem[] = [
      { id: 'old-agent', kind: 'agent', text: 'Older reply' },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-user',
        kind: 'user',
        text: 'Run the check',
        clientSendId: 'send-live-confirmed',
        transcript: {
          source: { provider: 'codex', backend: 'rpc', sessionId: 'thread-1' },
          itemId: 'send-live-confirmed',
        },
      },
    ]
    const reconciled = mergeConversationLiveTranscript(canonicalMessages, liveMessages)

    expect(appendPendingConversationMessagesToTranscript(
      reconciled,
      [pending],
      'conv-live',
    )).toEqual(reconciled)
    expect(hasPendingConversationMessages(reconciled, [pending], 'conv-live')).toBe(false)
    expect(pruneConfirmedPendingConversationMessages([pending], reconciled, 'conv-live')).toEqual([])
  })

  it('keeps richer live assistant text when the canonical page contains only a partial replay', () => {
    const canonicalMessages: MsgItem[] = [
      {
        id: 'canonical-agent-partial',
        kind: 'agent',
        text: 'Codex answer',
        transcript: {
          source: { provider: 'codex', backend: 'rpc', sessionId: 'thread-1' },
          turnId: 'turn-live-1',
          itemId: 'msg-live-answer',
        },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-agent-full',
        kind: 'agent',
        text: 'Codex answer that should not flicker away.',
        transcript: {
          source: { provider: 'codex', backend: 'rpc', sessionId: 'thread-1' },
          turnId: 'turn-live-1',
          itemId: 'msg-live-answer',
        },
      },
    ]

    expect(mergeConversationLiveTranscript(canonicalMessages, liveMessages)).toEqual([
      liveMessages[0],
    ])
  })

  it('merges canonical history, pending sends, and live echoes into one sequenced transcript', () => {
    const pending = createPendingConversationMessage({
      conversationId: 'conv-merge',
      text: 'Check order',
      clientSendId: 'send-merge',
    })
    if (!pending) {
      throw new Error('expected pending message')
    }
    const canonicalMessages: MsgItem[] = [
      {
        id: 'canonical-old-agent',
        kind: 'agent',
        text: 'Earlier answer',
        transcript: { seq: 1, source: { provider: 'claude', backend: 'cli' } },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-user-confirmed',
        kind: 'user',
        text: 'Check order',
        clientSendId: 'send-merge',
        transcript: { seq: 2, source: { provider: 'claude', backend: 'cli' }, itemId: 'send-merge' },
      },
      {
        id: 'live-agent-reply',
        kind: 'agent',
        text: 'Order is correct.',
        transcript: { seq: 3, source: { provider: 'claude', backend: 'cli' }, itemId: 'assistant-merge' },
      },
    ]

    expect(mergeConversationTranscriptSources({
      canonicalMessages,
      liveMessages,
      pendingMessages: [pending],
      conversationId: 'conv-merge',
    })).toEqual([
      canonicalMessages[0],
      liveMessages[0],
      liveMessages[1],
    ])
  })

  it('ignores live replay records that only have local sequence metadata', () => {
    const canonicalMessages: MsgItem[] = [
      {
        id: 'canonical-agent',
        kind: 'agent',
        text: 'Canonical answer',
        transcript: { seq: 1, source: { provider: 'claude', backend: 'cli' }, itemId: 'canonical-agent' },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'stale-live-agent',
        kind: 'agent',
        text: 'Stale replay from a prior stream',
        transcript: { seq: 2, source: { provider: 'claude', backend: 'cli' } },
      },
    ]

    expect(mergeConversationTranscriptSources({
      canonicalMessages,
      liveMessages,
    })).toEqual(canonicalMessages)
  })

  it('sorts stale canonical pages and newer live turns by durable transcript sequence', () => {
    const canonicalMessages: MsgItem[] = [
      {
        id: 'canonical-old-user',
        kind: 'user',
        text: 'Earlier prompt',
        transcript: { seq: 1, source: { provider: 'codex', backend: 'rpc' }, itemId: 'old-user' },
      },
      {
        id: 'canonical-later-agent',
        kind: 'agent',
        text: 'Later canonical replay',
        transcript: { seq: 4, source: { provider: 'codex', backend: 'rpc' }, itemId: 'later-agent' },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-current-user',
        kind: 'user',
        text: 'Current prompt',
        clientSendId: 'send-current',
        transcript: { seq: 2, source: { provider: 'codex', backend: 'rpc' }, itemId: 'send-current' },
      },
      {
        id: 'live-current-agent',
        kind: 'agent',
        text: 'Current live answer',
        transcript: { seq: 3, source: { provider: 'codex', backend: 'rpc' }, itemId: 'current-agent' },
      },
    ]

    expect(mergeConversationTranscriptSources({
      canonicalMessages,
      liveMessages,
    })).toEqual([
      canonicalMessages[0],
      liveMessages[0],
      liveMessages[1],
      canonicalMessages[1],
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
