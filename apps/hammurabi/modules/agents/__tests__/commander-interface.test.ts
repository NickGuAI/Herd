/**
 * Tests for createCommanderSessionsInterface — the #921 P5 extraction.
 *
 * The factory under test composes the CommanderSessionsInterface from
 * router-local context dependencies. These tests inject stub closures so
 * we can verify:
 *   1. createCommanderSession calls the right creator based on agentType
 *      and wires the resulting session into the sessions Map.
 *   2. replaceCommanderSession tears down the old runtime, preserves
 *      replay state + event subscriptions keyed by session name, and
 *      swaps in the new provider implementation under the same slot.
 *   3. sendToSession routes immediate sends to sendImmediateTextToStreamSession
 *      and queued sends to enqueueQueuedMessage + scheduleQueuedMessageDrain.
 *   4. deleteSession tears down codex vs gemini vs claude sessions via the
 *      right teardown closure and strips sessions + handlers afterwards.
 *   5. subscribeToEvents adds + removes handlers correctly.
 *   6. shutdown fans out to both runtime shutdowns.
 *
 * These tests pin the contract between the router and the extracted
 * interface so future refactors can't silently drop a closure dependency.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createCommanderSessionsInterface,
  type CommanderInterfaceContext,
} from '../commander-interface'
import { createClaudeProviderContext, createCodexProviderContext } from '../providers/provider-session-context'
import type { AgentType, AnySession, StreamJsonEvent, StreamSession } from '../types'
import type { QueuedMessage, QueuedMessageImage } from '../message-queue'

type SessionClient = StreamSession['clients'] extends Set<infer T> ? T : never

function makeClaudeStreamSession(name: string): StreamSession {
  // The sessionsInterface only reads .kind, .agentType, .clients, .process
  // from the result of createStreamSession on the claude path. A minimal
  // stub satisfies the extraction contract without forcing us to construct
  // a fully-populated StreamSession.
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    clients: new Set(),
    process: { kill: vi.fn() } as unknown as StreamSession['process'],
    events: [],
    queuedMessages: [],
    // deliberately partial — other fields are never read by the interface
  } as unknown as StreamSession
}

function makeCodexStreamSession(name: string): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'codex',
    clients: new Set(),
    events: [],
    queuedMessages: [],
  } as unknown as StreamSession
}

interface TestCommanderInterfaceContext extends CommanderInterfaceContext {
  createClaudeSessionMock: ReturnType<typeof vi.fn>
  createCodexSessionMock: ReturnType<typeof vi.fn>
  createGeminiSessionMock: ReturnType<typeof vi.fn>
  teardownProviderSessionMock: ReturnType<typeof vi.fn>
  shutdownProviderRuntimesMock: ReturnType<typeof vi.fn>
}

function makeBaseContext(
  overrides: Partial<TestCommanderInterfaceContext> = {},
): TestCommanderInterfaceContext {
  const createClaudeSessionMock = vi.fn(async (name: string) => makeClaudeStreamSession(name))
  const createCodexSessionMock = vi.fn(async (name: string) => makeCodexStreamSession(name))
  const createGeminiSessionMock = vi.fn(async (name: string) => {
    const session = makeClaudeStreamSession(name)
    ;(session as unknown as { agentType: string }).agentType = 'gemini'
    return session
  })
  const teardownProviderSessionMock = vi.fn(async (session: StreamSession) => {
    if (session.agentType === 'claude') {
      session.process.kill('SIGTERM')
    }
  })
  const shutdownProviderRuntimesMock = vi.fn(async () => undefined)
  const defaults: TestCommanderInterfaceContext = {
    sessions: new Map(),
    sessionEventHandlers: new Map(),
    schedulePersistedSessionsWrite: vi.fn(),
    createClaudeSessionMock,
    createCodexSessionMock,
    createGeminiSessionMock,
    createProviderStreamSession: vi.fn(async (name, _mode, _task, _cwd, _machine, agentType) => {
      if (agentType === 'codex') {
        return createCodexSessionMock(name)
      }
      if (agentType === 'gemini') {
        return createGeminiSessionMock(name)
      }
      return createClaudeSessionMock(name)
    }),
    createQueuedMessage: vi.fn((
      text,
      priority,
      images?: QueuedMessageImage[],
      displayText?: string,
      clientSendId?: string,
      userEventSubtype?: string,
    ) => ({
      id: 'queued-1',
      text,
      images,
      ...(displayText !== undefined ? { displayText } : {}),
      ...(clientSendId ? { clientSendId } : {}),
      ...(userEventSubtype ? { userEventSubtype } : {}),
      priority,
      queuedAt: new Date().toISOString(),
    }) as unknown as QueuedMessage),
    enqueueQueuedMessage: vi.fn(() => ({ ok: true as const })),
    scheduleQueuedMessageDrain: vi.fn(),
    sendImmediateTextToStreamSession: vi.fn(async () => ({
      ok: true as const,
      queued: false,
      message: { id: 'm', text: '' } as unknown as QueuedMessage,
    })),
    teardownProviderSession: teardownProviderSessionMock,
    teardownProviderSessionMock,
    shutdownProviderRuntimes: shutdownProviderRuntimesMock,
    shutdownProviderRuntimesMock,
  }
  return { ...defaults, ...overrides }
}

describe('createCommanderSessionsInterface — createCommanderSession', () => {
  it('routes claude to createStreamSession and writes to the sessions map', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    const session = await iface.createCommanderSession({
      name: 'commander-claude',
      commanderId: 'claude',
      systemPrompt: 'hello',
      agentType: 'claude',
      adaptiveThinking: 'enabled',
      maxThinkingTokens: 64000,
    })

    expect(ctx.createClaudeSessionMock).toHaveBeenCalledTimes(1)
    expect(ctx.createCodexSessionMock).not.toHaveBeenCalled()
    expect(ctx.createGeminiSessionMock).not.toHaveBeenCalled()
    expect(ctx.createProviderStreamSession).toHaveBeenCalledWith(
      'commander-claude',
      'default',
      '',
      expect.any(String),
      undefined,
      'claude',
      expect.objectContaining({
        adaptiveThinking: 'enabled',
        maxThinkingTokens: 64000,
      }),
    )
    expect(ctx.sessions.get('commander-claude')).toBe(session)
    expect(ctx.schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
  })

  it('routes codex through the provider registry creator', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.createCommanderSession({
      name: 'commander-codex',
      commanderId: 'codex',
      systemPrompt: 'hi',
      agentType: 'codex',
    })

    expect(ctx.createCodexSessionMock).toHaveBeenCalledTimes(1)
    expect(ctx.createClaudeSessionMock).not.toHaveBeenCalled()
    expect(ctx.sessions.has('commander-codex')).toBe(true)
  })

  it('routes gemini through the provider registry creator', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.createCommanderSession({
      name: 'commander-gemini',
      commanderId: 'gemini',
      systemPrompt: 'hi',
      agentType: 'gemini',
    })

    expect(ctx.createGeminiSessionMock).toHaveBeenCalledTimes(1)
    expect(ctx.sessions.has('commander-gemini')).toBe(true)
  })

  it('fails Codex commander resume instead of falling back to a fresh thread', async () => {
    const ctx = makeBaseContext({
      createCodexSessionMock: vi.fn(async () => {
        throw new Error('resume rollout missing')
      }),
    })
    ctx.createProviderStreamSession = vi.fn(async (name, _mode, _task, _cwd, _machine, agentType) => {
      if (agentType === 'codex') {
        return ctx.createCodexSessionMock(name)
      }
      if (agentType === 'gemini') {
        return ctx.createGeminiSessionMock(name)
      }
      return ctx.createClaudeSessionMock(name)
    })
    const iface = createCommanderSessionsInterface(ctx)

    await expect(iface.createCommanderSession({
      name: 'commander-codex-resume',
      commanderId: 'codex-resume',
      systemPrompt: 'hi',
      agentType: 'codex',
      resumeProviderContext: createCodexProviderContext({ threadId: 'stale-thread' }),
    })).rejects.toThrow('resume rollout missing')

    expect(ctx.createCodexSessionMock).toHaveBeenCalledTimes(1)
    expect(ctx.sessions.has('commander-codex-resume')).toBe(false)
    expect(ctx.schedulePersistedSessionsWrite).not.toHaveBeenCalled()
  })

  it('fails Claude commander resume instead of falling back to a fresh session', async () => {
    const ctx = makeBaseContext({
      createClaudeSessionMock: vi.fn(async () => {
        throw new Error('claude resume unavailable')
      }),
    })
    ctx.createProviderStreamSession = vi.fn(async (name, _mode, _task, _cwd, _machine, agentType) => {
      if (agentType === 'claude') {
        return ctx.createClaudeSessionMock(name)
      }
      return makeCodexStreamSession(name)
    })
    const iface = createCommanderSessionsInterface(ctx)

    await expect(iface.createCommanderSession({
      name: 'commander-claude-resume',
      commanderId: 'claude-resume',
      systemPrompt: 'hi',
      agentType: 'claude',
      resumeProviderContext: createClaudeProviderContext({ sessionId: 'stale-claude-session' }),
    })).rejects.toThrow('claude resume unavailable')

    expect(ctx.createClaudeSessionMock).toHaveBeenCalledTimes(1)
    expect(ctx.sessions.has('commander-claude-resume')).toBe(false)
    expect(ctx.schedulePersistedSessionsWrite).not.toHaveBeenCalled()
  })

  it('does not treat foreign or missing provider context ids as native resume ids', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.createCommanderSession({
      name: 'codex-to-claude',
      commanderId: 'foreign-context',
      systemPrompt: 'hi',
      agentType: 'claude',
      resumeProviderContext: createCodexProviderContext({ threadId: 'codex-thread' }),
    })
    await iface.createCommanderSession({
      name: 'claude-without-session-id',
      commanderId: 'missing-context-id',
      systemPrompt: 'hi',
      agentType: 'claude',
      resumeProviderContext: createClaudeProviderContext(),
    })

    const createCalls = vi.mocked(ctx.createProviderStreamSession).mock.calls
    const firstOptions = createCalls[0]?.[6]
    const secondOptions = createCalls[1]?.[6]
    expect(firstOptions).not.toEqual(expect.objectContaining({ resumeSessionId: expect.any(String) }))
    expect(secondOptions).not.toEqual(expect.objectContaining({ resumeSessionId: expect.any(String) }))
  })
})

describe('createCommanderSessionsInterface — replaceCommanderSession', () => {
  const providerSwapPairs: Array<[AgentType, AgentType]> = [
    ['claude', 'codex'],
    ['claude', 'gemini'],
    ['codex', 'claude'],
    ['codex', 'gemini'],
    ['gemini', 'claude'],
    ['gemini', 'codex'],
  ]

  it.each(providerSwapPairs)(
    'swaps %s to %s in place while preserving name-bound event handlers',
    async (fromAgentType, toAgentType) => {
      const name = `${fromAgentType}-to-${toAgentType}`
      const ctx = makeBaseContext()
      const iface = createCommanderSessionsInterface(ctx)
      const handler = vi.fn()
      const unsubscribe = iface.subscribeToEvents(name, handler)
      const handlersBeforeSwap = ctx.sessionEventHandlers.get(name)

      const previous = await iface.createCommanderSession({
        name,
        commanderId: name,
        systemPrompt: 'before',
        agentType: fromAgentType,
      })

      const previousEvents = [
        { type: 'user', text: `from-${fromAgentType}` } as unknown as StreamJsonEvent,
        { type: 'assistant', text: `to-${toAgentType}` } as unknown as StreamJsonEvent,
      ]
      previous.events = previousEvents
      previous.usage = {
        inputTokens: 13,
        outputTokens: 21,
        costUsd: 5,
      }
      previous.conversationEntryCount = 3
      previous.autoRotatePending = true

      const firstClient = { close: vi.fn() } as unknown as SessionClient
      const secondClient = { close: vi.fn() } as unknown as SessionClient
      previous.clients.add(firstClient)
      previous.clients.add(secondClient)

      const claudeKillSpy = vi.fn()
      if (fromAgentType === 'claude') {
        ;(previous as { process: { kill: typeof claudeKillSpy } }).process = {
          kill: claudeKillSpy,
        }
      }

      const replacement = await iface.replaceCommanderSession({
        name,
        commanderId: name,
        systemPrompt: 'after',
        agentType: toAgentType,
      })

      expect(ctx.sessions.get(name)).toBe(replacement)
      expect(replacement).not.toBe(previous)
      expect(replacement.agentType).toBe(toAgentType)
      expect(replacement.events).toEqual(previousEvents)
      expect(replacement.events).not.toBe(previousEvents)
      expect(replacement.usage).toEqual(previous.usage)
      expect(replacement.usage).not.toBe(previous.usage)
      expect(replacement.conversationEntryCount).toBe(previous.conversationEntryCount)
      expect(replacement.autoRotatePending).toBe(previous.autoRotatePending)
      expect(replacement.clients.has(firstClient)).toBe(true)
      expect(replacement.clients.has(secondClient)).toBe(true)
      expect(previous.clients.size).toBe(0)
      expect((firstClient as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled()
      expect((secondClient as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled()
      expect(ctx.schedulePersistedSessionsWrite).toHaveBeenCalledTimes(2)

      expect(ctx.teardownProviderSessionMock).toHaveBeenCalledTimes(1)
      expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
        previous,
        `Provider swap on session "${name}"`,
      )
      if (fromAgentType === 'claude') {
        expect(claudeKillSpy).toHaveBeenCalledWith('SIGTERM')
      } else {
        expect(claudeKillSpy).not.toHaveBeenCalled()
      }

      const handlersAfterSwap = ctx.sessionEventHandlers.get(name)
      expect(handlersAfterSwap).toBe(handlersBeforeSwap)
      expect(handlersAfterSwap?.has(handler)).toBe(true)

      const event = { type: 'assistant', text: 'provider swapped' } as unknown as StreamJsonEvent
      handlersAfterSwap?.forEach((listener) => listener(event))
      expect(handler).toHaveBeenCalledWith(event)

      unsubscribe()
    },
  )
})

describe('createCommanderSessionsInterface — sendToSession', () => {
  it('immediate send calls sendImmediateTextToStreamSession and returns its ok', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', 'hello')

    expect(ok).toBe(true)
    expect(ctx.sendImmediateTextToStreamSession).toHaveBeenCalledTimes(1)
    expect(ctx.sendImmediateTextToStreamSession).toHaveBeenCalledWith(session, 'hello', undefined)
    expect(ctx.enqueueQueuedMessage).not.toHaveBeenCalled()
  })

  it('immediate send forwards image payloads through sendImmediateTextToStreamSession', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)
    const image = { mediaType: 'image/png', data: 'base64-data' }

    const ok = await iface.sendToSession('target', { text: 'hello', images: [image] })

    expect(ok).toBe(true)
    expect(ctx.sendImmediateTextToStreamSession).toHaveBeenCalledWith(session, 'hello', [image])
  })

  it('immediate send forwards internal user event subtype through sendImmediateTextToStreamSession', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', {
      text: 'Commander runtime started. Acknowledge readiness and await instructions.',
      userEventSubtype: 'commander_startup',
    })

    expect(ok).toBe(true)
    expect(ctx.sendImmediateTextToStreamSession).toHaveBeenCalledWith(
      session,
      'Commander runtime started. Acknowledge readiness and await instructions.',
      undefined,
      undefined,
      undefined,
      'commander_startup',
    )
  })

  it('queued send routes through createQueuedMessage + enqueue + drain', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', 'deferred', { queue: true, priority: 'high' })

    expect(ok).toBe(true)
    expect(ctx.createQueuedMessage).toHaveBeenCalledWith('deferred', 'high', undefined)
    expect(ctx.enqueueQueuedMessage).toHaveBeenCalledTimes(1)
    expect(ctx.scheduleQueuedMessageDrain).toHaveBeenCalledTimes(1)
    expect(ctx.sendImmediateTextToStreamSession).not.toHaveBeenCalled()
  })

  it('queued send forwards image payloads through createQueuedMessage', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)
    const image = { mediaType: 'image/png', data: 'base64-data' }

    const ok = await iface.sendToSession('target', { text: '', images: [image] }, { queue: true })

    expect(ok).toBe(true)
    expect(ctx.createQueuedMessage).toHaveBeenCalledWith('', 'normal', [image])
    expect(ctx.enqueueQueuedMessage).toHaveBeenCalledTimes(1)
    expect(ctx.scheduleQueuedMessageDrain).toHaveBeenCalledTimes(1)
  })

  it('queued send forwards internal user event subtype through createQueuedMessage', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession(
      'target',
      { text: '[HEARTBEAT]', userEventSubtype: 'heartbeat' },
      { queue: true, priority: 'low' },
    )

    expect(ok).toBe(true)
    expect(ctx.createQueuedMessage).toHaveBeenCalledWith(
      '[HEARTBEAT]',
      'low',
      undefined,
      undefined,
      undefined,
      'heartbeat',
    )
    expect(ctx.enqueueQueuedMessage).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ userEventSubtype: 'heartbeat' }),
    )
    expect(ctx.scheduleQueuedMessageDrain).toHaveBeenCalledTimes(1)
  })

  it('returns false when the session does not exist', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    expect(await iface.sendToSession('missing', 'x')).toBe(false)
    expect(ctx.sendImmediateTextToStreamSession).not.toHaveBeenCalled()
  })

  it('returns false when queued send fails to enqueue', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({
      sessions,
      enqueueQueuedMessage: vi.fn(() => ({ ok: false as const, error: 'full' })),
    })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', 'x', { queue: true })

    expect(ok).toBe(false)
    expect(ctx.scheduleQueuedMessageDrain).not.toHaveBeenCalled()
  })
})

describe('createCommanderSessionsInterface — deleteSession', () => {
  it('tears down a codex session via teardownProviderSession', () => {
    const session = makeCodexStreamSession('codex-1')
    const sessions = new Map<string, AnySession>([['codex-1', session]])
    const sessionEventHandlers = new Map<string, Set<(e: StreamJsonEvent) => void>>([
      ['codex-1', new Set()],
    ])
    const ctx = makeBaseContext({ sessions, sessionEventHandlers })
    const iface = createCommanderSessionsInterface(ctx)

    iface.deleteSession('codex-1')

    expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
      session,
      'Commander stopped session "codex-1"',
    )
    expect(sessions.has('codex-1')).toBe(false)
    expect(sessionEventHandlers.has('codex-1')).toBe(false)
    expect(ctx.schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
  })

  it('tears down a claude session via teardownProviderSession', () => {
    const session = makeClaudeStreamSession('claude-1')
    const killSpy = vi.fn()
    ;(session as unknown as { process: { kill: typeof killSpy } }).process = { kill: killSpy }
    const sessions = new Map<string, AnySession>([['claude-1', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    iface.deleteSession('claude-1')

    expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
      session,
      'Commander stopped session "claude-1"',
    )
    expect(killSpy).toHaveBeenCalledWith('SIGTERM')
    expect(sessions.has('claude-1')).toBe(false)
  })

  it('is a no-op when the session does not exist (no teardown calls, no persistence)', () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    iface.deleteSession('does-not-exist')

    expect(ctx.teardownProviderSessionMock).not.toHaveBeenCalled()
    expect(ctx.schedulePersistedSessionsWrite).not.toHaveBeenCalled()
  })
})

describe('createCommanderSessionsInterface — subscribeToEvents + shutdown', () => {
  it('subscribeToEvents registers the handler and the returned fn unsubscribes', () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)
    const handler = vi.fn()

    const unsubscribe = iface.subscribeToEvents('session-x', handler)
    expect(ctx.sessionEventHandlers.get('session-x')?.has(handler)).toBe(true)

    unsubscribe()
    // After the last handler removes, the Set is cleaned up entirely.
    expect(ctx.sessionEventHandlers.has('session-x')).toBe(false)
  })

  it('shutdown delegates to shutdownProviderRuntimes', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.shutdown?.()

    expect(ctx.shutdownProviderRuntimesMock).toHaveBeenCalledTimes(1)
  })
})
