import { describe, expect, it } from 'vitest'
import { normalizeClaudeEvent } from '../../event-normalizers/claude'

const CLAUDE_SOURCE = {
  source: { provider: 'claude', backend: 'cli' },
} as const

function withClaudeSource<T extends object>(event: T): T & typeof CLAUDE_SOURCE {
  return {
    ...event,
    ...CLAUDE_SOURCE,
  }
}

describe('agents/event-normalizers/claude', () => {
  it('maps EnterPlanMode to a planning.enter event', () => {
    const result = normalizeClaudeEvent({
      type: 'assistant',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'plan-enter', name: 'EnterPlanMode' }],
      },
    })

    expect(result).toEqual(withClaudeSource({
      type: 'planning',
      action: 'enter',
    }))
  })

  it('maps ExitPlanMode input plans to blocking plan approvals', () => {
    const result = normalizeClaudeEvent({
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

    expect(result).toEqual(withClaudeSource({
      type: 'plan_approval',
      interactionKind: 'plan_approval',
      toolId: 'plan-exit',
      toolName: 'ExitPlanMode',
      plan: '1. Inspect the stream path\n2. Patch the normalizer',
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      customResponseLabel: 'Add response',
      providerContext: {
        provider: 'claude',
        backend: 'cli',
        toolUseId: 'plan-exit',
        toolName: 'ExitPlanMode',
        answerFormat: 'claude.exit_plan_mode',
      },
    }))
  })

  it('filters plan-mode tool traffic while preserving other assistant content', () => {
    const result = normalizeClaudeEvent({
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

    expect(result).toEqual([
      withClaudeSource({
        type: 'assistant',
        message: {
          id: 'assistant-3',
          role: 'assistant',
          content: [{ type: 'text', text: 'I investigated the issue.' }],
        },
      }),
      withClaudeSource({
        type: 'planning',
        action: 'enter',
      }),
      withClaudeSource({
        type: 'assistant',
        message: {
          id: 'assistant-3',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'git status' } }],
        },
      }),
    ])
  })

  it('maps ExitPlanMode approval payloads to planning.decision', () => {
    const result = normalizeClaudeEvent({
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

    expect(result).toEqual(withClaudeSource({
      type: 'planning',
      action: 'decision',
      toolId: 'plan-exit',
      approved: true,
      message: 'Proceeding with the approved plan.',
    }))
  })

  it('keeps AskUserQuestion events unchanged', () => {
    const event = {
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
    }

    expect(normalizeClaudeEvent(event)).toEqual(withClaudeSource(event))
  })

  it('projects signed empty thinking blocks into the backend-owned redaction text', () => {
    const signature = 'A'.repeat(464)

    const result = normalizeClaudeEvent({
      type: 'assistant',
      message: {
        id: 'assistant-thinking',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature }],
      },
    })

    expect(result).toEqual(withClaudeSource({
      type: 'assistant',
      message: {
        id: 'assistant-thinking',
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
          signature,
        }],
      },
    }))
  })
})
