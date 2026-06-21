import { describe, expect, it } from 'vitest'
import {
  createClaudeTranscriptMapper,
  mapClaudeToTranscriptEnvelopes,
} from '../../event-normalizers/claude'

describe('agents/event-normalizers/claude', () => {
  it('maps EnterPlanMode to a v2 plan update envelope', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'assistant',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'plan-enter', name: 'EnterPlanMode' }],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        source: expect.objectContaining({ provider: 'claude', backend: 'cli', rawEventType: 'assistant' }),
        ev: { type: 'plan.update', plan: { action: 'enter' } },
      }),
    ])
  })

  it('maps ExitPlanMode input plans to blocking v2 approvals', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'assistant',
      message: {
        id: 'assistant-2',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'plan-exit',
            name: 'ExitPlanMode',
            input: { plan: '1. Inspect the stream path\n2. Patch the normalizer' },
          },
        ],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'plan-exit',
        ev: { type: 'plan.update', plan: '1. Inspect the stream path\n2. Patch the normalizer' },
      }),
      expect.objectContaining({
        itemId: 'plan-exit',
        ev: expect.objectContaining({
          type: 'approval.request',
          toolCallId: 'plan-exit',
          interactionKind: 'plan_approval',
          prompt: '1. Inspect the stream path\n2. Patch the normalizer',
          request: expect.objectContaining({
            toolName: 'ExitPlanMode',
            providerContext: {
              provider: 'claude',
              backend: 'cli',
              toolUseId: 'plan-exit',
              toolName: 'ExitPlanMode',
              answerFormat: 'claude.exit_plan_mode',
            },
          }),
        }),
      }),
    ])
  })

  it('filters plan-mode tool traffic while preserving other assistant content', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'assistant',
      message: {
        id: 'assistant-3',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I investigated the issue.' },
          { type: 'tool_use', id: 'plan-enter', name: 'EnterPlanMode' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'git status' } },
        ],
      },
    })

    expect(result.map((event) => event.ev.type)).toEqual([
      'message.start',
      'message.delta',
      'message.end',
      'plan.update',
      'tool.start',
    ])
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'assistant-3',
        ev: { type: 'message.delta', text: 'I investigated the issue.', channel: 'final' },
      }),
      expect.objectContaining({
        itemId: 'tool-1',
        parentId: 'assistant-3',
        ev: { type: 'tool.start', toolCallId: 'tool-1', name: 'Bash', input: { command: 'git status' } },
      }),
    ]))
  })

  it('maps ExitPlanMode approval payloads to v2 approval resolution', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'plan-exit',
            content: '{"approved":true,"message":"Proceeding with the approved plan."}',
          },
        ],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'plan-exit',
        ev: {
          type: 'plan.update',
          plan: {
            action: 'decision',
            approved: true,
            message: 'Proceeding with the approved plan.',
          },
          toolCallId: 'plan-exit',
        },
      }),
      expect.objectContaining({
        itemId: 'plan-exit',
        ev: {
          type: 'approval.resolved',
          toolCallId: 'plan-exit',
          approved: true,
          result: 'Proceeding with the approved plan.',
        },
      }),
    ])
  })

  it('keeps AskUserQuestion as a v2 tool start', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'assistant',
      message: {
        id: 'assistant-4',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'ask-1',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Proceed?', header: 'Confirm', options: [], multiSelect: false }] },
          },
        ],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'ask-1',
        parentId: 'assistant-4',
        ev: expect.objectContaining({
          type: 'tool.start',
          toolCallId: 'ask-1',
          name: 'AskUserQuestion',
        }),
      }),
    ])
  })

  it('preserves streamed AskUserQuestion input JSON in the v2 tool start', () => {
    const mapper = createClaudeTranscriptMapper()
    const result = [
      ...mapper.map({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'ask-stream', name: 'AskUserQuestion', input: {} },
      }),
      ...mapper.map({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"questions":[{"question":"Proceed?",' },
      }),
      ...mapper.map({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"header":"Confirm","options":[],"multiSelect":false}]}' },
      }),
      ...mapper.map({ type: 'content_block_stop', index: 0 }),
    ]

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'ask-stream',
        ev: {
          type: 'tool.start',
          toolCallId: 'ask-stream',
          name: 'AskUserQuestion',
          input: {
            questions: [{
              question: 'Proceed?',
              header: 'Confirm',
              options: [],
              multiSelect: false,
            }],
          },
        },
      }),
    ])
  })

  it('preserves streamed ExitPlanMode input JSON as plan and approval envelopes', () => {
    const mapper = createClaudeTranscriptMapper()
    const result = [
      ...mapper.map({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'plan-stream', name: 'ExitPlanMode', input: {} },
      }),
      ...mapper.map({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"plan":"1. Inspect stream handling\\n' },
      }),
      ...mapper.map({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '2. Patch replay"}' },
      }),
      ...mapper.map({ type: 'content_block_stop', index: 0 }),
    ]

    expect(result.map((event) => event.ev.type)).toEqual(['plan.update', 'approval.request'])
    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'plan-stream',
        ev: { type: 'plan.update', plan: '1. Inspect stream handling\n2. Patch replay' },
      }),
      expect.objectContaining({
        itemId: 'plan-stream',
        ev: expect.objectContaining({
          type: 'approval.request',
          toolCallId: 'plan-stream',
          prompt: '1. Inspect stream handling\n2. Patch replay',
        }),
      }),
    ])
  })

  it('preserves streamed Bash input JSON in the v2 tool start', () => {
    const mapper = createClaudeTranscriptMapper()
    const result = [
      ...mapper.map({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'bash-stream', name: 'Bash', input: {} },
      }),
      ...mapper.map({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":"pnpm test"}' },
      }),
      ...mapper.map({ type: 'content_block_stop', index: 0 }),
    ]

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'bash-stream',
        ev: {
          type: 'tool.start',
          toolCallId: 'bash-stream',
          name: 'Bash',
          input: { command: 'pnpm test' },
        },
      }),
    ])
  })

  it('projects signed empty thinking blocks into backend-owned redaction text', () => {
    const signature = 'A'.repeat(464)

    const result = mapClaudeToTranscriptEnvelopes({
      type: 'assistant',
      message: {
        id: 'assistant-thinking',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature }],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'assistant-thinking',
        ev: {
          type: 'thinking.delta',
          text: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
        },
      }),
    ])
  })

  it('emits a structured terminal provider error for Claude result failures', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'result',
      subtype: 'failed',
      is_error: true,
      api_error_status: 429,
      result: 'rate_limit (429)',
    })

    expect(result.map((event) => event.ev.type)).toEqual(['provider.error', 'turn.end'])
    expect(result[0]).toEqual(expect.objectContaining({
      ev: {
        type: 'provider.error',
        message: 'rate_limit (429)',
        classification: 'usage_limit',
        code: '429',
        retryable: false,
        data: expect.objectContaining({ api_error_status: 429 }),
      },
    }))
    expect(result[1]).toEqual(expect.objectContaining({
      ev: expect.objectContaining({
        type: 'turn.end',
        status: 'error',
        error: 'rate_limit (429)',
      }),
    }))
  })

  it('classifies Claude auth failures through the same provider error event', () => {
    const result = mapClaudeToTranscriptEnvelopes({
      type: 'result',
      subtype: 'error',
      is_error: true,
      error_code: 'authentication_error',
      result: 'Error: auth token expired',
    })

    expect(result[0]).toEqual(expect.objectContaining({
      ev: expect.objectContaining({
        type: 'provider.error',
        message: 'Error: auth token expired',
        classification: 'auth_required',
        code: 'authentication_error',
      }),
    }))
  })
})
