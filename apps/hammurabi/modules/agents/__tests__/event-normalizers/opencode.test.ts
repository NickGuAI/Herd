import { describe, expect, it } from 'vitest'

import {
  createOpenCodeTurnState,
  normalizeOpenCodeSessionUpdate,
} from '../../event-normalizers/opencode'

const OPENCODE_SOURCE = {
  source: { provider: 'opencode', backend: 'acp' },
} as const

function withOpenCodeSource<T extends object>(event: T): T & typeof OPENCODE_SOURCE {
  return {
    ...event,
    ...OPENCODE_SOURCE,
  }
}

describe('agents/event-normalizers/opencode', () => {
  it('keeps non-blocking plan summaries read-only', () => {
    const result = normalizeOpenCodeSessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect current behavior', status: 'completed' },
        { content: 'Patch the normalizer', status: 'in_progress' },
      ],
    }, createOpenCodeTurnState())

    expect(result).toEqual(withOpenCodeSource({
      type: 'planning',
      action: 'proposed',
      plan: '[x] Inspect current behavior\n[>] Patch the normalizer',
    }))
  })

  it('maps waiting plan updates into blocking plan approval asks', () => {
    const result = normalizeOpenCodeSessionUpdate({
      type: 'plan',
      toolCallId: 'opencode-plan-1',
      status: 'waiting_for_approval',
      plan: '1. Patch\n2. Test',
      expiresAt: '2026-05-19T00:05:00.000Z',
      defaultDecision: 'reject',
    }, createOpenCodeTurnState())

    expect(result).toEqual(withOpenCodeSource({
      type: 'plan_approval',
      interactionKind: 'plan_approval',
      toolId: 'opencode-plan-1',
      toolName: 'PlanApproval',
      plan: '1. Patch\n2. Test',
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      customResponseLabel: 'Response',
      expiresAt: '2026-05-19T00:05:00.000Z',
      defaultDecision: 'reject',
      providerContext: {
        provider: 'opencode',
        backend: 'acp',
        toolUseId: 'opencode-plan-1',
        toolName: 'PlanApproval',
        answerFormat: 'opencode.plan_decision',
      },
    }))
  })
})
