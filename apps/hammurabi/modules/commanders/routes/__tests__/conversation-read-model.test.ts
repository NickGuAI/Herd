import { describe, expect, it, vi } from 'vitest'

import { buildConversationSummaryDTO } from '../conversation-read-model.js'
import type { Conversation } from '../../conversation-store.js'
import type { CommanderRoutesContext } from '../types.js'
import { createClaudeProviderContext } from '../../../agents/providers/provider-session-context.js'

function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    commanderId: '00000000-0000-4000-a000-0000000000aa',
    surface: 'ui',
    agentType: 'claude',
    name: 'Recoverable active conversation',
    status: 'active',
    currentTask: null,
    providerContext: createClaudeProviderContext({ sessionId: 'claude-session-1' }),
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    creationSource: 'ui',
    createdByKind: 'human',
    createdAt: '2026-05-04T00:00:00.000Z',
    lastMessageAt: '2026-05-04T00:00:00.000Z',
    ...overrides,
  } as Conversation
}

function buildContext(): CommanderRoutesContext {
  return {
    sessionsInterface: {
      getSession: vi.fn(() => undefined),
    },
  } as unknown as CommanderRoutesContext
}

describe('buildConversationSummaryDTO', () => {
  it('allows POST send recovery for active conversations without a live stream', () => {
    const dto = buildConversationSummaryDTO(buildContext(), buildConversation())

    expect(dto.runtimeState).toBe('idle')
    expect(dto.websocketReady).toBe(false)
    expect(dto.liveSession).toBeNull()
    expect(dto.allowedActions.send).toBe(true)
    expect(dto.allowedActions.queue).toBe(false)
    expect(dto.allowedActions.media).toBe(false)
    expect(dto.displayState.isSendable).toBe(true)
    expect(dto.displayState.isQueueable).toBe(false)
    expect(dto.sendTarget).toMatchObject({
      kind: 'conversation',
      transportType: null,
      agentType: 'claude',
    })
  })
})
