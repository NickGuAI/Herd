import { describe, expect, it } from 'vitest'
import type { TranscriptEnvelope } from '../../../../src/types/transcript-envelope'
import { mapClaudeToTranscriptEnvelopes } from '../../event-normalizers/claude'
import { mapCodexToTranscriptEnvelopes } from '../../event-normalizers/codex'
import type { StreamJsonEvent } from '../../types'
import { mapStreamEventsToMessages } from '../history'
import { MAX_CLIENT_MESSAGES } from '../model'

function assistantTextEvent(index: number): StreamJsonEvent {
  return {
    type: 'assistant',
    message: {
      id: `message-${index}`,
      role: 'assistant',
      content: [{ type: 'text', text: `message ${index}` }],
    },
  }
}

function codexEnvelope(
  id: string,
  input: Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source'> & {
    rawEventType: string
    rawEventId?: string
  },
): StreamJsonEvent {
  const { rawEventType, rawEventId, ...rest } = input
  return {
    schemaVersion: 2,
    id,
    time: '2026-06-15T17:08:16.923Z',
    source: {
      provider: 'codex',
      backend: 'rpc',
      sessionId: 'thread-stable-history',
      rawEventType,
      rawEventId: rawEventId ?? rest.itemId ?? id,
    },
    ...rest,
  } satisfies TranscriptEnvelope
}

function claudeEnvelope(
  id: string,
  input: Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source'> & {
    rawEventType: string
    rawEventId?: string
  },
): StreamJsonEvent {
  const { rawEventType, rawEventId, ...rest } = input
  return {
    schemaVersion: 2,
    id,
    time: '2026-06-15T17:08:16.923Z',
    source: {
      provider: 'claude',
      backend: 'cli',
      sessionId: 'claude-stable-history',
      rawEventType,
      rawEventId: rawEventId ?? rest.itemId ?? id,
    },
    ...rest,
  } satisfies TranscriptEnvelope
}

describe('mapStreamEventsToMessages', () => {
  it('preserves server-side replay history beyond the client render cap', () => {
    const messageCount = MAX_CLIENT_MESSAGES + 25

    const messages = mapStreamEventsToMessages(
      Array.from({ length: messageCount }, (_, index) => assistantTextEvent(index)),
    )

    expect(messages).toHaveLength(messageCount)
    expect(messages[0]).toMatchObject({ kind: 'agent', text: 'message 0' })
    expect(messages[messageCount - 1]).toMatchObject({
      kind: 'agent',
      text: `message ${messageCount - 1}`,
    })
  })

  it('renders Claude signed empty thinking through the backend projection contract', () => {
    const signature = 'A'.repeat(464)

    const messages = mapStreamEventsToMessages([{
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'claude-thinking',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature }],
      },
    }])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
      }),
    ])
  })

  it('projects streamed Claude tool input JSON across replay events', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'content_block_start',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
        content_block: { type: 'tool_use', id: 'bash-stream', name: 'Bash', input: {} },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":"pnpm test"}' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'tool',
        toolName: 'Bash',
        toolInput: 'pnpm test',
        toolFile: 'pnpm test',
      }),
    ])
  })

  it('projects user display text without leaking provider-bound workspace context', () => {
    const messages = mapStreamEventsToMessages([{
      type: 'user',
      subtype: 'queued_message',
      displayText: 'Use this context.',
      message: {
        role: 'user',
        content: '<workspace-files>\n@README.md\n</workspace-files>\nUse this context.',
      },
    } as StreamJsonEvent])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Use this context.',
      }),
    ])
    expect(messages[0]?.text).not.toContain('<workspace-')
  })

  it('does not project internal commander startup user prompts as visible chat messages', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'commander_startup',
        message: {
          role: 'user',
          content: 'Commander runtime started. Acknowledge readiness and await instructions.',
        },
      },
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'visible follow-up',
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'visible follow-up',
      }),
    ])
  })

  it('does not project internal heartbeat user prompts as visible chat messages', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'heartbeat',
        message: {
          role: 'user',
          content: 'You are Commander, the orchestration agent.\n\n[HEARTBEAT 2026-06-15]',
        },
      },
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'visible follow-up',
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'visible follow-up',
      }),
    ])
  })

  it('does not replay legacy Claude heartbeat transcript envelopes as user chat', () => {
    const messages = mapStreamEventsToMessages([
      claudeEnvelope('legacy-heartbeat-start', {
        rawEventType: 'hammurabi/user',
        itemId: 'queue-legacy-heartbeat',
        ev: { type: 'message.start', role: 'user' },
      }),
      claudeEnvelope('legacy-heartbeat-delta', {
        rawEventType: 'hammurabi/user',
        itemId: 'queue-legacy-heartbeat',
        ev: {
          type: 'message.delta',
          channel: 'final',
          text: [
            'You are Commander, the orchestration agent for GitHub task execution.',
            '',
            '[HEARTBEAT 2026-06-15T17:08:16.923Z]',
            '',
            '## Claude Code Reasoning Policy',
          ].join('\n'),
        },
      }),
      claudeEnvelope('legacy-heartbeat-end', {
        rawEventType: 'hammurabi/user',
        itemId: 'queue-legacy-heartbeat',
        ev: { type: 'message.end' },
      }),
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'real user message',
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'real user message',
      }),
    ])
  })

  it('preserves real queued user messages that only mention heartbeat text', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'Please search for "[HEARTBEAT]" in the docs.',
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Please search for "[HEARTBEAT]" in the docs.',
      }),
    ])
  })

  it('dedupes queued user echoes separated by provider status activity', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'repeat-safe prompt',
        },
      },
      {
        schemaVersion: 2,
        id: 'env-status-between-user-echoes',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/status/changed' },
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      },
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'repeat-safe prompt',
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'user', text: 'repeat-safe prompt' }),
      expect.objectContaining({ kind: 'provider', text: 'Thread status changed' }),
    ])
  })

  it('dedupes queued user echoes separated by an empty Codex turn placeholder', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'status',
        },
      },
      {
        schemaVersion: 2,
        id: 'env-status-active',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/status/changed' },
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      },
      {
        schemaVersion: 2,
        id: 'env-empty-turn-start',
        time: '2026-05-29T00:00:01.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'turn/started' },
        turnId: 'turn-status',
        ev: { type: 'message.start', role: 'assistant' },
      },
      {
        schemaVersion: 2,
        id: 'env-user-start',
        time: '2026-05-29T00:00:02.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
        turnId: 'turn-status',
        itemId: 'user-status',
        ev: {
          type: 'provider.activity',
          title: 'User message item started',
          detail: 'userMessage',
        },
      },
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'status',
        },
      },
    ] as StreamJsonEvent[])

    const statusMessages = messages.filter((message) => (
      message.kind === 'user' && message.text === 'status'
    ))
    expect(statusMessages).toHaveLength(1)
  })

  it('renders Codex v2 thinking deltas as reasoning messages', () => {
    const messages = mapStreamEventsToMessages([
      {
        schemaVersion: 2,
        id: 'env-thinking-delta',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/reasoning/textDelta' },
        turnId: 'turn-reasoning',
        itemId: 'reasoning-1',
        ev: { type: 'thinking.delta', text: 'Final completed reasoning' },
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: 'Final completed reasoning',
      }),
    ])
  })

  it('projects terminal Codex provider errors as visible error messages', () => {
    const events = mapCodexToTranscriptEnvelopes('error', {
      threadId: 'thread-codex-quota',
      turnId: 'turn-codex-quota',
      willRetry: false,
      error: {
        message: 'You have hit your usage limit. Upgrade to Pro or try again later.',
        codexErrorInfo: 'usageLimitExceeded',
      },
    })

    const messages = mapStreamEventsToMessages(events)

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        text: 'Codex error',
      }),
      expect.objectContaining({
        kind: 'error',
        text: 'You have hit your usage limit. Upgrade to Pro or try again later.',
        providerError: expect.objectContaining({
          classification: 'usage_limit',
          code: 'usageLimitExceeded',
        }),
      }),
    ]))
  })

  it('does not project retryable Codex provider errors as terminal failures', () => {
    const events = mapCodexToTranscriptEnvelopes('error', {
      threadId: 'thread-codex-retry',
      turnId: 'turn-codex-retry',
      willRetry: true,
      error: {
        message: 'Temporary provider disconnect',
        code: 'temporary',
      },
    })

    const messages = mapStreamEventsToMessages(events)

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'provider',
        text: 'Codex error',
      }),
    ])
    expect(messages.some((message) => message.kind === 'error')).toBe(false)
  })

  it('projects terminal Claude provider errors through the same visible error message kind', () => {
    const events = mapClaudeToTranscriptEnvelopes({
      type: 'result',
      subtype: 'failed',
      is_error: true,
      api_error_status: 401,
      result: 'Error: auth token expired',
    })

    const messages = mapStreamEventsToMessages(events)

    expect(messages.filter((message) => message.kind === 'error')).toEqual([
      expect.objectContaining({
        text: 'Error: auth token expired',
        providerError: expect.objectContaining({
          classification: 'auth_required',
          code: '401',
        }),
      }),
    ])
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'system', text: 'Awaiting input' }),
    ]))
  })

  it('renders Gemini and OpenCode canonical stream events without provider branching', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'content_block_start',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
        delta: { type: 'text_delta', text: 'Gemini says hi' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
      },
      {
        type: 'content_block_start',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
        content_block: { type: 'thinking' },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
        delta: { type: 'thinking_delta', thinking: 'OpenCode thought' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'agent', text: 'Gemini says hi' }),
      expect.objectContaining({ kind: 'thinking', text: 'OpenCode thought' }),
    ])
  })

  it('keeps unknown-provider thinking fallback safe and text-only', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'assistant',
        source: { provider: 'test-provider', backend: 'cli' },
        message: {
          id: 'unknown-thinking',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'visible fallback' },
            { type: 'thinking', thinking: '' },
          ],
        },
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'thinking', text: 'visible fallback' }),
    ])
  })

  it('projects v2 transcript envelopes through the same reducer path as live events', () => {
    const messages = mapStreamEventsToMessages([
      {
        schemaVersion: 2,
        id: 'env-turn-start',
        time: '2026-05-27T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'turn/started' },
        turnId: 'turn-1',
        ev: { type: 'turn.start', role: 'assistant' },
      },
      {
        schemaVersion: 2,
        id: 'env-message-start',
        time: '2026-05-27T00:00:01.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
        turnId: 'turn-1',
        itemId: 'msg-1',
        ev: { type: 'message.start', role: 'assistant' },
      },
      {
        schemaVersion: 2,
        id: 'env-message-delta',
        time: '2026-05-27T00:00:02.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
        turnId: 'turn-1',
        itemId: 'msg-1',
        ev: { type: 'message.delta', text: 'Transcript v2 says hi', channel: 'final' },
      },
      {
        schemaVersion: 2,
        id: 'env-tool-start',
        time: '2026-05-27T00:00:03.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
        turnId: 'turn-1',
        itemId: 'tool-1',
        ev: { type: 'tool.start', toolCallId: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      },
      {
        schemaVersion: 2,
        id: 'env-tool-delta',
        time: '2026-05-27T00:00:04.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/commandExecution/outputDelta' },
        turnId: 'turn-1',
        itemId: 'tool-1',
        ev: { type: 'tool.delta', toolCallId: 'tool-1', output: '/tmp/project\n', status: 'running' },
      },
      {
        schemaVersion: 2,
        id: 'env-provider-raw',
        time: '2026-05-27T00:00:05.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/custom' },
        turnId: 'turn-1',
        ev: { type: 'provider.raw', method: 'thread/custom', payload: { keep: true } },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'agent',
        text: 'Transcript v2 says hi',
        transcript: expect.objectContaining({
          source: expect.objectContaining({ provider: 'codex', backend: 'rpc' }),
          itemId: 'msg-1',
        }),
      }),
      expect.objectContaining({
        kind: 'tool',
        toolName: 'Bash',
        toolInput: 'pwd',
        toolOutput: '/tmp/project\n',
        transcript: expect.objectContaining({
          itemId: 'tool-1',
          providerEventType: 'item/commandExecution/outputDelta',
        }),
      }),
      expect.objectContaining({
        kind: 'provider',
        text: 'codex raw: thread/custom',
        transcript: expect.objectContaining({
          providerPayload: { keep: true },
        }),
      }),
    ])
  })

  it('reconciles completed Codex agentMessage text without duplicating live deltas', () => {
    const messages = mapStreamEventsToMessages([
      codexEnvelope('env-message-start', {
        rawEventType: 'item/started',
        rawEventId: 'msg-recovered',
        turnId: 'turn-recovered',
        itemId: 'msg-recovered',
        ev: { type: 'message.start', role: 'assistant' },
      }),
      codexEnvelope('env-live-delta', {
        rawEventType: 'item/agentMessage/delta',
        rawEventId: 'msg-recovered',
        turnId: 'turn-recovered',
        itemId: 'msg-recovered',
        ev: { type: 'message.delta', text: 'Recovered final', channel: 'final' },
      }),
      codexEnvelope('env-completed-start', {
        rawEventType: 'item/completed',
        rawEventId: 'msg-recovered',
        turnId: 'turn-recovered',
        itemId: 'msg-recovered',
        ev: { type: 'message.start', role: 'assistant' },
      }),
      codexEnvelope('env-completed-delta', {
        rawEventType: 'item/completed',
        rawEventId: 'msg-recovered',
        turnId: 'turn-recovered',
        itemId: 'msg-recovered',
        ev: { type: 'message.delta', text: 'Recovered final answer', channel: 'final' },
      }),
      codexEnvelope('env-completed-end', {
        rawEventType: 'item/completed',
        rawEventId: 'msg-recovered',
        turnId: 'turn-recovered',
        itemId: 'msg-recovered',
        ev: { type: 'message.end' },
      }),
    ])

    const assistantMessages = messages.filter((message) => message.kind === 'agent')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.text).toBe('Recovered final answer')
  })

  it('derives stable ids for persisted Codex messages across sliding transcript windows', () => {
    const clientSendId = 'send-stable-window'
    const assistantItemId = 'msg-stable-window-answer'
    const sharedTurnEvents = [
      codexEnvelope('env-user-start', {
        rawEventType: 'hammurabi/user',
        rawEventId: clientSendId,
        itemId: clientSendId,
        clientSendId,
        seq: 20,
        ev: { type: 'message.start', role: 'user' },
      }),
      codexEnvelope('env-user-delta', {
        rawEventType: 'hammurabi/user',
        rawEventId: clientSendId,
        itemId: clientSendId,
        clientSendId,
        seq: 21,
        ev: { type: 'message.delta', text: 'Run the stable id check', channel: 'final' },
      }),
      codexEnvelope('env-user-end', {
        rawEventType: 'hammurabi/user',
        rawEventId: clientSendId,
        itemId: clientSendId,
        clientSendId,
        seq: 22,
        ev: { type: 'message.end' },
      }),
      codexEnvelope('env-assistant-start', {
        rawEventType: 'item/started',
        rawEventId: assistantItemId,
        turnId: 'turn-stable-window',
        itemId: assistantItemId,
        seq: 23,
        ev: { type: 'message.start', role: 'assistant' },
      }),
      codexEnvelope('env-assistant-delta', {
        rawEventType: 'item/agentMessage/delta',
        rawEventId: assistantItemId,
        turnId: 'turn-stable-window',
        itemId: assistantItemId,
        seq: 24,
        ev: { type: 'message.delta', text: 'Stable answer', channel: 'final' },
      }),
    ] as StreamJsonEvent[]

    const firstWindow = mapStreamEventsToMessages([
      codexEnvelope('env-provider-a', {
        rawEventType: 'thread/status/changed',
        rawEventId: 'status-a',
        seq: 1,
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      }),
      codexEnvelope('env-provider-b', {
        rawEventType: 'thread/status/changed',
        rawEventId: 'status-b',
        seq: 2,
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      }),
      ...sharedTurnEvents,
    ])
    const shiftedWindow = mapStreamEventsToMessages([
      codexEnvelope('env-provider-b', {
        rawEventType: 'thread/status/changed',
        rawEventId: 'status-b',
        seq: 2,
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      }),
      ...sharedTurnEvents,
    ])

    const firstUser = firstWindow.find((message) => message.clientSendId === clientSendId)
    const shiftedUser = shiftedWindow.find((message) => message.clientSendId === clientSendId)
    const firstAssistant = firstWindow.find((message) => message.transcript?.itemId === assistantItemId)
    const shiftedAssistant = shiftedWindow.find((message) => message.transcript?.itemId === assistantItemId)

    expect(firstUser?.id).toBe(shiftedUser?.id)
    expect(firstAssistant?.id).toBe(shiftedAssistant?.id)
    expect(firstUser?.id).toMatch(/^hist-user-/)
    expect(firstAssistant?.id).toMatch(/^hist-agent-/)
  })

  it('keeps persisted Codex raw delta envelopes as provider activity', () => {
    const messages = mapStreamEventsToMessages([
      {
        schemaVersion: 2,
        id: 'env-raw-delta-1',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
        turnId: 'turn-raw',
        itemId: 'msg-raw',
        ev: {
          type: 'provider.raw',
          method: 'item/agentMessage/delta',
          payload: { delta: 'Final ' },
        },
      },
      {
        schemaVersion: 2,
        id: 'env-raw-delta-2',
        time: '2026-05-29T00:00:01.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
        turnId: 'turn-raw',
        itemId: 'msg-raw',
        ev: {
          type: 'provider.raw',
          method: 'item/agentMessage/delta',
          payload: { delta: 'answer' },
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'provider',
        text: 'codex raw: item/agentMessage/delta',
        transcript: expect.objectContaining({
          providerPayload: { delta: 'Final ' },
        }),
      }),
      expect.objectContaining({
        kind: 'provider',
        text: 'codex raw: item/agentMessage/delta',
        transcript: expect.objectContaining({
          providerPayload: { delta: 'answer' },
        }),
      }),
    ])
  })
})
