import { describe, expect, it } from 'vitest'
import { mapCodexToTranscriptEnvelopes } from '../../event-normalizers/codex'

describe('agents/event-normalizers/codex', () => {
  describe('TranscriptEnvelope v2 mapping', () => {
    it('covers every Codex app-server event family called out by issue #1569', () => {
      const cases: Array<{
        method: string
        params: Record<string, unknown>
        expectedEventTypes: string[]
      }> = [
        {
          method: 'thread/archived',
          params: { thread: { id: 'thread-coverage' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'thread/unarchived',
          params: { thread: { id: 'thread-coverage' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'thread/closed',
          params: { thread: { id: 'thread-coverage' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'thread/status/changed',
          params: { thread: { id: 'thread-coverage' }, status: 'archived' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'turn/diff/updated',
          params: { turn: { id: 'turn-coverage', threadId: 'thread-coverage' }, diff: '@@' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'turn/plan/updated',
          params: { turn: { id: 'turn-coverage', threadId: 'thread-coverage' }, plan: '1. Test' },
          expectedEventTypes: ['plan.update'],
        },
        {
          method: 'item/plan/delta',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'plan-coverage',
            delta: 'Add all event coverage',
          },
          expectedEventTypes: ['plan.update'],
        },
        {
          method: 'item/reasoning/summaryPartAdded',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'reasoning-coverage',
            summary: { text: 'Observed a branch' },
          },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'item/commandExecution/outputDelta',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'command-coverage',
            delta: 'stdout chunk',
          },
          expectedEventTypes: ['tool.delta'],
        },
        {
          method: 'serverRequest/resolved',
          params: { threadId: 'thread-coverage', requestId: 99 },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'fuzzyFileSearch/sessionUpdated',
          params: { threadId: 'thread-coverage', sessionId: 'search-1', query: 'routes' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'fuzzyFileSearch/sessionCompleted',
          params: { threadId: 'thread-coverage', sessionId: 'search-1' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'windowsSandbox/setupCompleted',
          params: { threadId: 'thread-coverage', sandboxId: 'sandbox-1' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'error',
          params: { threadId: 'thread-coverage', error: { message: 'boom' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'item/tool/requestUserInput',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            requestId: 101,
            prompt: 'Need input',
          },
          expectedEventTypes: ['approval.request'],
        },
        {
          method: 'item/tool/call',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'dynamic-call-coverage',
            tool: { name: 'lookup' },
          },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'account/rateLimits/updated',
          params: {
            rateLimits: {
              primary: { usedPercent: 99, resetsAt: 1781798203 },
              secondary: { usedPercent: 21 },
              planType: 'pro',
            },
          },
          expectedEventTypes: ['provider.activity'],
        },
      ]

      for (const testCase of cases) {
        const envelopes = mapCodexToTranscriptEnvelopes(testCase.method, testCase.params)
        expect(envelopes, testCase.method).toHaveLength(testCase.expectedEventTypes.length)
        expect(envelopes.map((envelope) => envelope.ev.type), testCase.method)
          .toEqual(testCase.expectedEventTypes)
        expect(envelopes.every((envelope) => envelope.schemaVersion === 2), testCase.method).toBe(true)
        expect(envelopes.every((envelope) => envelope.source.provider === 'codex'), testCase.method).toBe(true)
        expect(envelopes.some((envelope) => envelope.ev.type === 'provider.raw'), testCase.method).toBe(false)
      }
    })

    it('covers the Codex item lifecycle families without dropping to raw fallback', () => {
      const itemTypes = [
        'agentMessage',
        'plan',
        'reasoning',
        'commandExecution',
        'fileChange',
        'mcpToolCall',
        'dynamicToolCall',
        'collabToolCall',
        'collabAgentToolCall',
        'webSearch',
        'imageView',
        'enteredReviewMode',
        'exitedReviewMode',
        'contextCompaction',
      ]

      for (const itemType of itemTypes) {
        const started = mapCodexToTranscriptEnvelopes('item/started', {
          threadId: 'thread-items',
          turnId: 'turn-items',
          item: {
            id: `${itemType}-started`,
            type: itemType,
            command: 'pwd',
            changes: [{ path: 'src/app.ts', kind: 'update', diff: '@@' }],
            text: 'Plan text',
          },
        })
        const completed = mapCodexToTranscriptEnvelopes('item/completed', {
          threadId: 'thread-items',
          turnId: 'turn-items',
          item: {
            id: `${itemType}-completed`,
            type: itemType,
            command: 'pwd',
            output: 'done',
            changes: [{ path: 'src/app.ts', kind: 'update', diff: '@@' }],
            text: 'Plan text',
          },
        })

        expect(started.length, `${itemType} started`).toBeGreaterThan(0)
        expect(completed.length, `${itemType} completed`).toBeGreaterThan(0)
        expect(started.every((envelope) => envelope.ev.type !== 'provider.raw'), `${itemType} started`).toBe(true)
        expect(completed.every((envelope) => envelope.ev.type !== 'provider.raw'), `${itemType} completed`).toBe(true)
      }
    })

    it('suppresses Codex userMessage item reflections in the live transcript envelope mapper', () => {
      const userMessageItem = {
        id: 'user-message-reflection',
        type: 'userMessage',
        input: [
          {
            type: 'image',
            url: 'data:image/png;base64,reflected-image',
          },
        ],
      }

      expect(mapCodexToTranscriptEnvelopes('item/started', {
        threadId: 'thread-user-reflection',
        turnId: 'turn-user-reflection',
        item: userMessageItem,
      })).toEqual([])

      expect(mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: 'thread-user-reflection',
        turnId: 'turn-user-reflection',
        item: userMessageItem,
      })).toEqual([])
    })

    it('surfaces high Codex account rate limit notifications as readable activity', () => {
      const envelopes = mapCodexToTranscriptEnvelopes('account/rateLimits/updated', {
        rateLimits: {
          primary: { usedPercent: 98.7, resetsAt: 1781798203 },
          secondary: { usedPercent: 21 },
          planType: 'pro',
          rateLimitReachedType: null,
        },
      })

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0]).toEqual(expect.objectContaining({
        source: expect.objectContaining({
          provider: 'codex',
          backend: 'rpc',
          rawEventType: 'account/rateLimits/updated',
        }),
        ev: expect.objectContaining({
          type: 'provider.activity',
          title: 'Codex quota nearly exhausted',
          detail: expect.stringContaining('primary quota 99% used'),
          data: expect.objectContaining({
            rateLimit: expect.objectContaining({
              primaryUsedPercent: 98.7,
              secondaryUsedPercent: 21,
              planType: 'pro',
            }),
          }),
        }),
      }))
    })

    it('surfaces high secondary Codex account rate limit notifications', () => {
      const envelopes = mapCodexToTranscriptEnvelopes('account/rateLimits/updated', {
        rateLimits: {
          primary: { usedPercent: 18, resetsAt: 1781798203 },
          secondary: { usedPercent: 94.2 },
          planType: 'pro',
        },
      })

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0]).toEqual(expect.objectContaining({
        ev: expect.objectContaining({
          type: 'provider.activity',
          title: 'Codex quota nearly exhausted',
          detail: expect.stringContaining('weekly quota 94% used'),
        }),
      }))
    })

    it('suppresses low Codex account rate limit notifications', () => {
      expect(mapCodexToTranscriptEnvelopes('account/rateLimits/updated', {
        rateLimits: {
          primary: { usedPercent: 18, resetsAt: 1781798203 },
          secondary: { usedPercent: 21 },
          planType: 'pro',
        },
      })).toEqual([])
    })

    it('normalizes Codex collabAgentToolCall items into Agent tool lifecycle envelopes', () => {
      const started = mapCodexToTranscriptEnvelopes('item/started', {
        threadId: 'thread-collab',
        turnId: 'turn-collab',
        item: {
          id: 'call-collab-1',
          type: 'collabAgentToolCall',
          name: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Investigate transcript noise',
          status: 'inProgress',
        },
      })
      const completed = mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: 'thread-collab',
        turnId: 'turn-collab',
        item: {
          id: 'call-collab-1',
          type: 'collabAgentToolCall',
          name: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Investigate transcript noise',
          status: 'completed',
          receiverThreadIds: ['thread-child-1'],
        },
      })

      expect(started).toEqual([
        expect.objectContaining({
          itemId: 'call-collab-1',
          ev: expect.objectContaining({
            type: 'tool.start',
            toolCallId: 'call-collab-1',
            name: 'Agent',
            input: expect.objectContaining({
              prompt: 'Investigate transcript noise',
            }),
          }),
        }),
      ])
      expect(completed).toEqual([
        expect.objectContaining({
          itemId: 'call-collab-1',
          ev: expect.objectContaining({
            type: 'tool.end',
            toolCallId: 'call-collab-1',
            status: 'ok',
          }),
        }),
      ])
    })

    it('maps command output deltas to tool.delta envelopes', () => {
      expect(mapCodexToTranscriptEnvelopes('item/commandExecution/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        delta: 'hello\n',
      })).toEqual([
        expect.objectContaining({
          schemaVersion: 2,
          source: expect.objectContaining({
            provider: 'codex',
            backend: 'rpc',
            sessionId: 'thread-1',
            rawEventType: 'item/commandExecution/outputDelta',
            rawEventId: 'cmd-1',
          }),
          turnId: 'turn-1',
          itemId: 'cmd-1',
          ev: {
            type: 'tool.delta',
            toolCallId: 'cmd-1',
            output: 'hello\n',
          },
        }),
      ])
    })

    it('maps Codex agent message delta payloads into final assistant text chunks', () => {
      expect(mapCodexToTranscriptEnvelopes('item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Final answer chunk',
      })).toEqual([
        expect.objectContaining({
          schemaVersion: 2,
          source: expect.objectContaining({
            provider: 'codex',
            backend: 'rpc',
            sessionId: 'thread-1',
            rawEventType: 'item/agentMessage/delta',
            rawEventId: 'msg-1',
          }),
          turnId: 'turn-1',
          itemId: 'msg-1',
          ev: {
            type: 'message.delta',
            text: 'Final answer chunk',
            channel: 'final',
          },
        }),
      ])
    })

    it('maps completed Codex agent messages with accumulated text into assistant text envelopes', () => {
      expect(mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          text: 'Recovered final answer',
        },
      })).toEqual([
        expect.objectContaining({
          turnId: 'turn-1',
          itemId: 'msg-1',
          ev: { type: 'message.start', role: 'assistant' },
        }),
        expect.objectContaining({
          turnId: 'turn-1',
          itemId: 'msg-1',
          ev: {
            type: 'message.delta',
            text: 'Recovered final answer',
            channel: 'final',
          },
        }),
        expect.objectContaining({
          turnId: 'turn-1',
          itemId: 'msg-1',
          ev: { type: 'message.end' },
        }),
      ])
    })

    it('maps file change output deltas to tool.delta envelopes', () => {
      expect(mapCodexToTranscriptEnvelopes('item/fileChange/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'file-1',
        diff: '@@ -1 +1 @@',
      })).toEqual([
        expect.objectContaining({
          schemaVersion: 2,
          source: expect.objectContaining({
            rawEventType: 'item/fileChange/outputDelta',
            rawEventId: 'file-1',
          }),
          turnId: 'turn-1',
          itemId: 'file-1',
          ev: {
            type: 'tool.delta',
            toolCallId: 'file-1',
            output: '@@ -1 +1 @@',
            patch: '@@ -1 +1 @@',
          },
        }),
      ])
    })

    it('maps plan updates and preserves unknown events as provider.raw', () => {
      expect(mapCodexToTranscriptEnvelopes('turn/plan/updated', {
        turn: { id: 'turn-2' },
        plan: '1. Inspect\n2. Patch',
      })[0]).toEqual(expect.objectContaining({
        schemaVersion: 2,
        turnId: 'turn-2',
        ev: {
          type: 'plan.update',
          plan: '1. Inspect\n2. Patch',
        },
      }))

      expect(mapCodexToTranscriptEnvelopes('thread/customFutureEvent', {
        thread: { id: 'thread-2' },
        payload: { keep: 'me' },
      })[0]).toEqual(expect.objectContaining({
        schemaVersion: 2,
        source: expect.objectContaining({
          sessionId: 'thread-2',
          rawEventType: 'thread/customFutureEvent',
        }),
        ev: {
          type: 'provider.raw',
          method: 'thread/customFutureEvent',
          payload: {
            thread: { id: 'thread-2' },
            payload: { keep: 'me' },
          },
        },
      }))
    })

    it('maps completed file changes to file.change plus tool.end', () => {
      const envelopes = mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: 'thread-9',
        turnId: 'turn-9',
        item: {
          id: 'file-9',
          type: 'fileChange',
          changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@' }],
        },
      })

      expect(envelopes).toEqual([
        expect.objectContaining({
          itemId: 'file-9',
          ev: {
            type: 'file.change',
            path: 'src/example.ts',
            action: 'applied',
            data: expect.objectContaining({
              changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@' }],
            }),
          },
        }),
        expect.objectContaining({
          itemId: 'file-9',
          ev: {
            type: 'tool.end',
            toolCallId: 'file-9',
            status: 'ok',
            result: expect.objectContaining({
              changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@' }],
            }),
          },
        }),
      ])
    })

    it('preserves Codex tool requests and review lifecycle events as v2 envelopes', () => {
      expect(mapCodexToTranscriptEnvelopes('item/tool/requestUserInput', {
        threadId: 'thread-7',
        turnId: 'turn-7',
        requestId: 7,
        prompt: 'Need input',
      })[0]).toEqual(expect.objectContaining({
        itemId: '7',
        ev: expect.objectContaining({
          type: 'approval.request',
          toolCallId: '7',
          interactionKind: 'ask_user_question',
          prompt: 'Need input',
          request: expect.objectContaining({ prompt: 'Need input' }),
        }),
      }))

      expect(mapCodexToTranscriptEnvelopes('item/started', {
        threadId: 'thread-review',
        turnId: 'turn-review',
        item: { id: 'review-1', type: 'enteredReviewMode', review: { id: 'r1' } },
      })[0]).toEqual(expect.objectContaining({
        itemId: 'review-1',
        ev: {
          type: 'provider.activity',
          title: 'Review mode entered',
          detail: 'enteredReviewMode',
          data: expect.objectContaining({ review: { id: 'r1' } }),
        },
      }))
    })

    it('emits a structured terminal provider error for non-retryable Codex quota failures', () => {
      const envelopes = mapCodexToTranscriptEnvelopes('error', {
        threadId: 'thread-quota',
        turnId: 'turn-quota',
        willRetry: false,
        error: {
          message: 'You have hit your usage limit. Upgrade to Pro or try again later.',
          codexErrorInfo: 'usageLimitExceeded',
          additionalDetails: 'Try again after reset.',
        },
      })

      expect(envelopes.map((envelope) => envelope.ev.type)).toEqual([
        'provider.activity',
        'provider.error',
      ])
      expect(envelopes[1]).toEqual(expect.objectContaining({
        turnId: 'turn-quota',
        ev: {
          type: 'provider.error',
          message: 'You have hit your usage limit. Upgrade to Pro or try again later.',
          classification: 'usage_limit',
          code: 'usageLimitExceeded',
          hint: 'Try again after reset.',
          retryable: false,
          data: expect.objectContaining({ willRetry: false }),
        },
      }))
    })

    it('keeps retryable Codex errors as provider activity without terminal error surfacing', () => {
      const envelopes = mapCodexToTranscriptEnvelopes('error', {
        threadId: 'thread-retryable',
        turnId: 'turn-retryable',
        willRetry: true,
        error: {
          message: 'Temporary transport failure',
          code: 'temporary',
        },
      })

      expect(envelopes.map((envelope) => envelope.ev.type)).toEqual(['provider.activity'])
    })
  })
})
