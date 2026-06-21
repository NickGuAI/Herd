import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openHammurabiSqliteDatabase } from '../../../server/db/connection'
import { applyHammurabiSqliteSchema } from '../../../server/db/schema'
import {
  createMockChildProcess,
  mockedSpawn,
  startServer,
} from './routes-test-harness'
import type { RunningServer } from './routes-test-harness'

const COMMANDER_ID = '00000000-0000-4000-a000-0000000000aa'
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111'

type RuntimeSessionRow = {
  conversation_id: string | null
  session_type: string
  creator_kind: string
  creator_id: string | null
  provider_resume_json: string
}

function openTestRuntimeDb(dir: string): DatabaseSync {
  const db = openHammurabiSqliteDatabase(join(dir, 'hammurabi.sqlite'))
  applyHammurabiSqliteSchema(db)
  return db
}

function readRuntimeSession(db: DatabaseSync, name: string): RuntimeSessionRow | undefined {
  return db.prepare(
    `SELECT conversation_id, session_type, creator_kind, creator_id, provider_resume_json
     FROM agent_runtime_sessions
     WHERE name = ?`,
  ).get(name) as RuntimeSessionRow | undefined
}

describe('stream session conversation links', () => {
  function installMockProcess() {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValue(mock.cp as never)
    return mock
  }

  it('carries conversationId in live sessions and persists it across restart restore', async () => {
    const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-conversation-link-'))
    const sqliteDb = openTestRuntimeDb(sessionStoreDir)
    let firstServer: RunningServer | null = null
    let secondServer: RunningServer | null = null
    const firstMock = installMockProcess()

    try {
      firstServer = await startServer({
        autoResumeSessions: false,
        sqliteDb,
      })

      const created = await firstServer.agents.sessionsInterface.createCommanderSession({
        name: 'commander-conversation-link-01',
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        systemPrompt: 'Conversation session prompt',
        agentType: 'claude',
        cwd: '/tmp',
      })

      expect(created.conversationId).toBe(CONVERSATION_ID)
      expect(created.sessionType).toBe('commander')
      expect(created.creator).toEqual({
        kind: 'commander',
        id: COMMANDER_ID,
      })

      firstMock.emitStdout(
        '{"type":"system","subtype":"init","session_id":"claude-conversation-link-123"}\n',
      )

      await vi.waitFor(async () => {
        const saved = readRuntimeSession(sqliteDb, 'commander-conversation-link-01')
        expect(saved).toEqual(expect.objectContaining({
          conversation_id: CONVERSATION_ID,
          session_type: 'commander',
          creator_kind: 'commander',
          creator_id: COMMANDER_ID,
        }))
        expect(JSON.parse(saved!.provider_resume_json).sessionId).toBe('claude-conversation-link-123')
      })

      await firstServer.close()
      firstServer = null

      mockedSpawn.mockClear()
      installMockProcess()

      secondServer = await startServer({
        autoResumeSessions: true,
        sqliteDb,
      })

      await vi.waitFor(() => {
        const restored = secondServer?.agents.sessionsInterface.getSession('commander-conversation-link-01')
        expect(restored?.conversationId).toBe(CONVERSATION_ID)
        expect(restored?.sessionType).toBe('commander')
        expect(restored?.creator).toEqual({
          kind: 'commander',
          id: COMMANDER_ID,
        })
      })
    } finally {
      if (secondServer) {
        await secondServer.close()
      }
      if (firstServer) {
        await firstServer.close()
      }
      sqliteDb.close()
      await rm(sessionStoreDir, { recursive: true, force: true })
    }
  })

  it('preserves conversationId across auto-rotated commander sessions', async () => {
    // Regression for codex-review P1 (PR #1279): rotation used to drop
    // session.conversationId, falling back to buildLegacyCommanderConversationId
    // and seeding the next turn from the wrong conversation when multiple chats
    // exist under one commander.
    const processMocks: Array<ReturnType<typeof createMockChildProcess>> = []
    mockedSpawn.mockImplementation(() => {
      const mock = createMockChildProcess()
      processMocks.push(mock)
      return mock.cp as never
    })

    const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-conversation-rotation-'))
    const sqliteDb = openTestRuntimeDb(sessionStoreDir)
    let server: RunningServer | null = null

    try {
      server = await startServer({
        autoRotateEntryThreshold: 1,
        autoResumeSessions: false,
        sqliteDb,
      })

      const sessionName = 'commander-conversation-rotation-01'

      const created = await server.agents.sessionsInterface.createCommanderSession({
        name: sessionName,
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        systemPrompt: 'Conversation rotation prompt',
        agentType: 'claude',
        cwd: '/tmp',
      })

      expect(created.conversationId).toBe(CONVERSATION_ID)
      expect(processMocks).toHaveLength(1)

      // Drive a complete turn so the session crosses the rotation entry-count
      // threshold and is replaced by createReplacementStreamSession.
      processMocks[0].emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
      processMocks[0].emitStdout('{"type":"system","subtype":"init","session_id":"claude-rotation-old"}\n')
      processMocks[0].emitStdout('{"type":"result","result":"turn-1 done"}\n')

      await vi.waitFor(() => {
        expect(processMocks).toHaveLength(2)
      })

      // Live session must still carry the original conversationId after rotation.
      const live = server.agents.sessionsInterface.getSession(sessionName)
      expect(live?.conversationId).toBe(CONVERSATION_ID)

      // Persisted snapshot must round-trip the conversationId so a subsequent
      // rotation (which reads from session.conversationId again) does not
      // collapse to buildLegacyCommanderConversationId(commanderId).
      processMocks[1].emitStdout('{"type":"system","subtype":"init","session_id":"claude-rotation-new"}\n')

      await vi.waitFor(async () => {
        const saved = readRuntimeSession(sqliteDb, sessionName)
        expect(saved).toEqual(expect.objectContaining({
          conversation_id: CONVERSATION_ID,
        }))
        expect(JSON.parse(saved!.provider_resume_json).sessionId).toBe('claude-rotation-new')
      })
    } finally {
      if (server) {
        await server.close()
      }
      sqliteDb.close()
      await rm(sessionStoreDir, { recursive: true, force: true })
    }
  })
})
