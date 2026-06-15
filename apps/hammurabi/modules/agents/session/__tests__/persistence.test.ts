import { performance } from 'node:perf_hooks'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../json-file.js', () => ({
  writeJsonFileAtomically: vi.fn(async () => undefined),
}))

import { writeJsonFileAtomically } from '../../../json-file.js'
import {
  readPersistedSessionsState,
  restorePersistedSessions,
  serializePersistedSessionsState,
} from '../persistence.js'
import {
  resetTranscriptStoreRoot,
  setTranscriptStoreRoot,
} from '../../transcript-store.js'
import type {
  CompletedSession,
  ExitedStreamSessionState,
  PersistedStreamSession,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'

const writeJsonFileAtomicallyMock = vi.mocked(writeJsonFileAtomically)

function buildPersistedSession(name: string): PersistedStreamSession {
  return {
    name,
    agentType: 'claude',
    model: 'claude-sonnet-4-6',
    mode: 'default',
    cwd: '/tmp/project',
    createdAt: '2026-05-04T00:00:00.000Z',
    sessionType: 'commander',
    creator: { kind: 'commander', id: 'commander-1' },
    providerContext: {
      providerId: 'claude',
      sessionId: `${name}-resume`,
    },
  }
}

function buildRestoredSession(entry: PersistedStreamSession): StreamSession {
  return {
    kind: 'stream',
    name: entry.name,
    sessionType: entry.sessionType ?? 'commander',
    creator: entry.creator ?? { kind: 'commander', id: 'commander-1' },
    agentType: entry.agentType,
    model: entry.model,
    mode: entry.mode,
    cwd: entry.cwd,
    createdAt: entry.createdAt,
    lastEventAt: entry.createdAt,
    spawnedWorkers: [],
    events: [],
    clients: new Set(),
    systemPrompt: 'restored prompt',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: true,
    providerContext: entry.providerContext,
    conversationEntryCount: 0,
    autoRotatePending: false,
    codexUnclassifiedIncomingCount: 0,
    codexPendingApprovals: new Map(),
    messageQueue: null as unknown as StreamSession['messageQueue'],
    pendingDirectSendMessages: [],
    queuedMessageRetryDelayMs: 0,
    queuedMessageDrainScheduled: false,
    queuedMessageDrainPending: false,
    queuedMessageDrainPendingForce: false,
    restoredIdle: false,
  } as StreamSession
}

describe('session persistence quick wins', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hammurabi-persistence-test-'))
    setTranscriptStoreRoot(join(tempDir, 'transcripts'))
    writeJsonFileAtomicallyMock.mockClear()
  })

  afterEach(async () => {
    resetTranscriptStoreRoot()
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('restores persisted live sessions in parallel and shares the machine-registry read', async () => {
    const entries = [
      buildPersistedSession('restore-alpha'),
      buildPersistedSession('restore-beta'),
      buildPersistedSession('restore-gamma'),
    ]
    const sessionStorePath = join(tempDir, 'stream-sessions.json')
    await writeFile(sessionStorePath, JSON.stringify({ sessions: entries }, null, 2), 'utf8')

    const machineRegistry = {
      readMachineRegistry: vi.fn(async () => []),
    }
    const restoreProviderSession = vi.fn(async (entry: PersistedStreamSession) => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return buildRestoredSession(entry)
    })

    const startedAt = performance.now()
    const sessions = new Map<string, StreamSession>()
    await restorePersistedSessions({
      sessionStorePath,
      sessions,
      completedSessions: new Map<string, CompletedSession>(),
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
      maxSessions: 10,
      machineRegistry: machineRegistry as never,
      applyUsageEvent: vi.fn(),
      restoreProviderSession,
    })
    const elapsedMs = performance.now() - startedAt

    expect(restoreProviderSession).toHaveBeenCalledTimes(3)
    expect(machineRegistry.readMachineRegistry).toHaveBeenCalledTimes(1)
    expect(sessions.size).toBe(3)
    expect(elapsedMs).toBeLessThan(180)
  })

  it('skips rewriting persisted session state when providerContext migration is a no-op', async () => {
    const sessionStorePath = join(tempDir, 'stream-sessions.json')
    const payload = {
      sessions: [buildPersistedSession('canonical-session')],
    }
    await writeFile(sessionStorePath, JSON.stringify(payload, null, 2), 'utf8')

    const parsed = await readPersistedSessionsState(sessionStorePath)

    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0]?.providerContext).toEqual(expect.objectContaining({
      providerId: 'claude',
      sessionId: 'canonical-session-resume',
    }))
    expect(parsed.sessions[0]?.model).toBe('claude-sonnet-4-6')
    expect(writeJsonFileAtomicallyMock).not.toHaveBeenCalled()
  })

  it('round-trips model through restore and serialization', async () => {
    const entries = [buildPersistedSession('restore-model')]
    const sessionStorePath = join(tempDir, 'stream-sessions.json')
    await writeFile(sessionStorePath, JSON.stringify({ sessions: entries }, null, 2), 'utf8')

    const sessions = new Map<string, StreamSession>()
    await restorePersistedSessions({
      sessionStorePath,
      sessions,
      completedSessions: new Map<string, CompletedSession>(),
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
      maxSessions: 10,
      machineRegistry: {
        readMachineRegistry: vi.fn(async () => []),
      } as never,
      applyUsageEvent: vi.fn(),
      restoreProviderSession: vi.fn(async (entry: PersistedStreamSession) => buildRestoredSession(entry)),
    })

    expect(sessions.get('restore-model')?.model).toBe('claude-sonnet-4-6')

    const serialized = serializePersistedSessionsState({
      sessions: new Map(sessions),
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
    })
    expect(serialized.sessions[0]?.model).toBe('claude-sonnet-4-6')
  })

  it('restores exited v2 turn.end terminal statuses as completed session subtypes', async () => {
    const cases = [
      {
        sessionName: 'restore-failed-v2-turn',
        threadId: 'thread-failed-v2-turn',
        status: 'failed',
        expectedSubtype: 'failed',
        finalComment: 'Codex turn failed',
        costUsd: 0.42,
      },
      {
        sessionName: 'restore-interrupted-v2-turn',
        threadId: 'thread-interrupted-v2-turn',
        status: 'interrupted',
        expectedSubtype: 'interrupted',
        finalComment: '',
        costUsd: 0.11,
      },
    ]
    const entries: PersistedStreamSession[] = cases.map((testCase) => {
      const turnEnd: StreamJsonEvent = {
        schemaVersion: 2,
        id: `turn-end-${testCase.status}`,
        time: '2026-05-04T00:01:00.000Z',
        source: {
          provider: 'codex',
          backend: 'rpc',
          sessionId: testCase.threadId,
          rawEventType: 'hammurabi/codex-watchdog-thread-read',
        },
        turnId: `turn-${testCase.status}-v2`,
        ev: {
          type: 'turn.end',
          status: testCase.status,
          ...(testCase.finalComment ? { error: testCase.finalComment } : {}),
          result: {
            total_cost_usd: testCase.costUsd,
          },
        },
      }
      return {
        ...buildPersistedSession(testCase.sessionName),
        agentType: 'codex',
        providerContext: {
          providerId: 'codex',
          threadId: testCase.threadId,
        },
        sessionState: 'exited',
        hadResult: true,
        events: [turnEnd],
      }
    })
    const sessionStorePath = join(tempDir, 'stream-sessions.json')
    await writeFile(sessionStorePath, JSON.stringify({ sessions: entries }, null, 2), 'utf8')

    const completedSessions = new Map<string, CompletedSession>()
    const restoreProviderSession = vi.fn(async (persistedEntry: PersistedStreamSession) =>
      buildRestoredSession(persistedEntry)
    )

    await restorePersistedSessions({
      sessionStorePath,
      sessions: new Map<string, StreamSession>(),
      completedSessions,
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
      maxSessions: 10,
      machineRegistry: {
        readMachineRegistry: vi.fn(async () => []),
      } as never,
      applyUsageEvent: vi.fn(),
      restoreProviderSession,
    })

    expect(restoreProviderSession).not.toHaveBeenCalled()
    for (const testCase of cases) {
      expect(completedSessions.get(testCase.sessionName)).toMatchObject({
        subtype: testCase.expectedSubtype,
        finalComment: testCase.finalComment,
        costUsd: testCase.costUsd,
      })
    }
  })
})
