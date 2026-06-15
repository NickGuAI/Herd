import { describe, expect, it } from 'vitest'
import {
  createGeminiTurnState,
  mapGeminiPromptResponseToTranscriptEnvelopes,
  mapGeminiToTranscriptEnvelopes,
} from '../../event-normalizers/gemini'

describe('agents/event-normalizers/gemini', () => {
  it('maps non-final Gemini tool updates into v2 tool.delta envelopes', () => {
    const state = createGeminiTurnState()

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'tool_call_update',
      sessionId: 'gemini-session-1',
      toolCallId: 'tool-2',
      status: 'running',
      rawOutput: { progress: 'streaming' },
    }, state)).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        itemId: 'tool-2',
        source: expect.objectContaining({
          provider: 'gemini',
          backend: 'acp',
          sessionId: 'gemini-session-1',
          rawEventType: 'tool_call_update',
        }),
        ev: {
          type: 'tool.delta',
          toolCallId: 'tool-2',
          status: 'running',
          output: '{\n  "progress": "streaming"\n}',
          data: expect.objectContaining({ status: 'running' }),
        },
      }),
    ])
  })

  it('preserves unsupported Gemini updates and emits v2 prompt completion', () => {
    const state = createGeminiTurnState()

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'session/error',
      sessionId: 'gemini-session-2',
      error: { message: 'boom' },
    }, state)).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({
          rawEventType: 'session/error',
        }),
        ev: {
          type: 'provider.activity',
          title: 'session/error',
          data: expect.objectContaining({
            error: { message: 'boom' },
          }),
        },
      }),
    ])

    expect(mapGeminiPromptResponseToTranscriptEnvelopes({
      stopReason: 'end_turn',
      usage: { inputTokens: 2, outputTokens: 3 },
    }, state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ev: {
          type: 'turn.end',
          status: 'ok',
          result: 'Turn completed',
          usage: { input_tokens: 2, output_tokens: 3 },
          error: undefined,
        },
      }),
    ]))
  })

  it('preserves malformed Gemini updates as provider.raw envelopes', () => {
    expect(mapGeminiToTranscriptEnvelopes('not-json-object', createGeminiTurnState())).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        source: expect.objectContaining({
          provider: 'gemini',
          backend: 'acp',
        }),
        ev: {
          type: 'provider.raw',
          payload: 'not-json-object',
        },
      }),
    ])
  })

  it('maps Gemini ACP streaming chunks into canonical delta events', () => {
    const state = createGeminiTurnState()

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'pondering' },
    }, state)).toEqual([
      expect.objectContaining({
        itemId: 'content-block-0',
        ev: { type: 'thinking.delta', text: 'pondering' },
      }),
    ])

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'done' },
    }, state)).toEqual([
      expect.objectContaining({
        itemId: 'content-block-0',
        ev: { type: 'message.end' },
      }),
      expect.objectContaining({
        itemId: 'content-block-1',
        ev: { type: 'message.start', role: 'assistant' },
      }),
      expect.objectContaining({
        itemId: 'content-block-1',
        ev: { type: 'message.delta', text: 'done', channel: 'final' },
      }),
    ])
  })

  it('maps tool calls and prompt completion into canonical events', () => {
    const state = createGeminiTurnState()

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      kind: 'execute',
      title: 'Run shell command',
      rawInput: { command: 'pwd' },
    }, state)).toEqual([
      expect.objectContaining({
        itemId: 'tool-1',
        ev: { type: 'tool.start', toolCallId: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      }),
    ])

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: { stdout: '/tmp/project' },
    }, state)).toEqual([
      expect.objectContaining({
        itemId: 'tool-1',
        ev: {
          type: 'tool.end',
          toolCallId: 'tool-1',
          status: 'ok',
          result: '{\n  "stdout": "/tmp/project"\n}',
        },
      }),
    ])

    expect(mapGeminiPromptResponseToTranscriptEnvelopes({
      stopReason: 'end_turn',
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    }, state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ev: { type: 'provider.activity', title: 'Usage updated', data: { usage: { input_tokens: 4, output_tokens: 6 } } },
      }),
      expect.objectContaining({
        ev: {
          type: 'turn.end',
          status: 'ok',
          result: 'Turn completed',
          usage: { input_tokens: 4, output_tokens: 6 },
        },
      }),
    ]))
  })
})
