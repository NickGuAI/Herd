import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readSqlitePersistedSessionsState,
  writeSqlitePersistedSessionsState,
} from '../../modules/agents/session/sqlite-runtime-store.js'
import { createCodexProviderContext } from '../../modules/agents/providers/provider-session-context.js'
import { openHammurabiSqliteDatabase } from '../db/connection.js'
import {
  runSqliteMigration,
  SqliteMigrationRefusedError,
} from '../db/migration.js'
import { applyHammurabiSqliteSchema } from '../db/schema.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readTables(dbPath: string): string[] {
  const db = openHammurabiSqliteDatabase(dbPath)
  try {
    return (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
    ).all() as Array<{ name: string }>).map((row) => row.name)
  } finally {
    db.close()
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('SQLite runtime-session migration', () => {
  it('creates only schema metadata and agent runtime session tables', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-source-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')
    const sessionsPath = path.join(sourceRoot, 'agents', 'stream-sessions.json')

    await writeJson(sessionsPath, {
      sessions: [
        {
          name: 'commander-atlas-conversation-conv-main',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'atlas' },
          conversationId: 'conv-main',
          transportType: 'stream',
          agentType: 'codex',
          model: 'gpt-5-codex',
          mode: 'acceptEdits',
          cwd: '/repo',
          host: 'machine-remote',
          createdAt: '2026-06-20T01:00:00.000Z',
          sessionState: 'active',
          resumedFrom: 'source-session-1755',
          activeTurnId: 'turn-active-1755',
          conversationEntryCount: 7,
          approvalBridgeNonce: 'nonce-active-1755',
          currentSkillInvocation: {
            toolUseId: 'toolu-deep-devi',
            skillId: 'deep-devi',
            displayName: 'Deep Devi',
            startedAt: '2026-06-20T01:00:30.000Z',
          },
          spawnedWorkers: ['worker-1755'],
          queuedMessages: [{
            id: 'queued-normal',
            text: 'run verification',
            priority: 'normal',
            queuedAt: '2026-06-20T01:01:00.000Z',
          }],
          currentQueuedMessage: {
            id: 'queued-current',
            text: 'current direct send',
            priority: 'high',
            queuedAt: '2026-06-20T01:02:00.000Z',
          },
          pendingDirectSendMessages: [{
            id: 'queued-direct',
            text: 'pending direct send',
            priority: 'high',
            queuedAt: '2026-06-20T01:03:00.000Z',
          }],
          providerContext: {
            providerId: 'codex',
            threadId: 'codex-thread-active',
          },
          daemonProcess: {
            processId: 'daemon-proc-active',
            mode: 'pipe',
          },
          events: [{
            schemaVersion: 2,
            id: 'inline-replay-event-1',
            time: '2026-06-20T01:04:00.000Z',
            source: { kind: 'provider', provider: 'codex' },
            ev: {
              type: 'provider.activity',
              title: 'Inline replay event',
            },
          }],
        },
        {
          name: 'worker-1755',
          sessionType: 'worker',
          creator: { kind: 'commander', id: 'atlas' },
          spawnedBy: 'commander-atlas-conversation-conv-main',
          transportType: 'stream',
          agentType: 'claude',
          mode: 'default',
          cwd: '/repo',
          createdAt: '2026-06-20T01:05:00.000Z',
          sessionState: 'exited',
          hadResult: true,
          providerContext: {
            providerId: 'claude',
            sessionId: 'claude-session-paused',
            effort: 'high',
            adaptiveThinking: 'enabled',
            maxThinkingTokens: 64000,
          },
        },
      ],
    })

    const result = await runSqliteMigration({
      sourceRoot,
      dbPath,
      backup: true,
      now: () => new Date('2026-06-20T02:00:00.000Z'),
    })

    expect(readTables(dbPath)).toEqual(['agent_runtime_sessions', 'schema_migrations'])
    expect(result.stats).toMatchObject({
      sourceSessions: 2,
      importedSessions: 2,
      activeSessions: 1,
      pausedSessions: 1,
      skippedSessions: 0,
    })
    expect(result.stats.errors).toEqual([])
    expect(result.stats.backupPath).toBe(`${sessionsPath}.${result.runId}.bak`)
    await expect(access(result.stats.backupPath!)).resolves.toBeUndefined()
    await expect(access(result.stats.reportPath!)).resolves.toBeUndefined()

    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      const rows = db.prepare(
        `SELECT name, session_type, creator_kind, creator_id, conversation_id, spawned_by,
                transport_type, machine_id, state, provider, provider_resume_json, runtime_state_json, cwd,
                created_at, updated_at, archived_at
         FROM agent_runtime_sessions
         ORDER BY name ASC`,
      ).all() as Array<Record<string, string | null>>

      expect(rows).toEqual([
        expect.objectContaining({
          name: 'commander-atlas-conversation-conv-main',
          session_type: 'commander',
          creator_kind: 'commander',
          creator_id: 'atlas',
          conversation_id: 'conv-main',
          spawned_by: null,
          transport_type: 'stream',
          machine_id: 'machine-remote',
          state: 'active',
          provider: 'codex',
          cwd: '/repo',
          created_at: '2026-06-20T01:00:00.000Z',
          updated_at: '2026-06-20T02:00:00.000Z',
          archived_at: null,
        }),
        expect.objectContaining({
          name: 'worker-1755',
          session_type: 'worker',
          creator_kind: 'commander',
          creator_id: 'atlas',
          conversation_id: null,
          spawned_by: 'commander-atlas-conversation-conv-main',
          machine_id: 'local',
          state: 'paused',
          provider: 'claude',
        }),
      ])

      expect(JSON.parse(rows[0].provider_resume_json!)).toMatchObject({
        providerId: 'codex',
        threadId: 'codex-thread-active',
        daemonProcess: {
          processId: 'daemon-proc-active',
          mode: 'pipe',
        },
      })
      expect(JSON.parse(rows[1].provider_resume_json!)).toMatchObject({
        providerId: 'claude',
        sessionId: 'claude-session-paused',
        effort: 'high',
        adaptiveThinking: 'enabled',
        maxThinkingTokens: 64000,
      })

      expect(JSON.parse(rows[0].runtime_state_json!)).toMatchObject({
        model: 'gpt-5-codex',
        mode: 'acceptEdits',
        resumedFrom: 'source-session-1755',
        activeTurnId: 'turn-active-1755',
        conversationEntryCount: 7,
        approvalBridgeNonce: 'nonce-active-1755',
        currentSkillInvocation: {
          toolUseId: 'toolu-deep-devi',
          skillId: 'deep-devi',
          displayName: 'Deep Devi',
          startedAt: '2026-06-20T01:00:30.000Z',
        },
        spawnedWorkers: ['worker-1755'],
        queuedMessages: [expect.objectContaining({ id: 'queued-normal' })],
        currentQueuedMessage: expect.objectContaining({ id: 'queued-current' }),
        pendingDirectSendMessages: [expect.objectContaining({ id: 'queued-direct' })],
        events: [expect.objectContaining({ id: 'inline-replay-event-1' })],
      })
      expect(JSON.parse(rows[1].runtime_state_json!)).toMatchObject({
        mode: 'default',
        hadResult: true,
      })

      const restored = readSqlitePersistedSessionsState(db)
      expect(restored.sessions[0]).toMatchObject({
        name: 'commander-atlas-conversation-conv-main',
        model: 'gpt-5-codex',
        mode: 'acceptEdits',
        resumedFrom: 'source-session-1755',
        activeTurnId: 'turn-active-1755',
        conversationEntryCount: 7,
        approvalBridgeNonce: 'nonce-active-1755',
        currentSkillInvocation: {
          toolUseId: 'toolu-deep-devi',
          skillId: 'deep-devi',
          displayName: 'Deep Devi',
          startedAt: '2026-06-20T01:00:30.000Z',
        },
        spawnedWorkers: ['worker-1755'],
        queuedMessages: [expect.objectContaining({ id: 'queued-normal' })],
        currentQueuedMessage: expect.objectContaining({ id: 'queued-current' }),
        pendingDirectSendMessages: [expect.objectContaining({ id: 'queued-direct' })],
        events: [expect.objectContaining({ id: 'inline-replay-event-1' })],
      })
      expect(restored.sessions[1]).toMatchObject({
        name: 'worker-1755',
        effort: 'high',
        adaptiveThinking: 'enabled',
        maxThinkingTokens: 64000,
      })
    } finally {
      db.close()
    }

    const report = JSON.parse(await readFile(result.stats.reportPath!, 'utf8')) as {
      schemaVersion?: string
      stats?: unknown
    }
    expect(report.schemaVersion).toBe('002_agent_runtime_session_payload')
    expect(report.stats).toMatchObject({ importedSessions: 2 })
  })

  it('backfills legacy session ownership before validating SQLite importability', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-legacy-source-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')

    await writeJson(path.join(sourceRoot, 'agents', 'stream-sessions.json'), {
      sessions: [{
        name: 'commander-atlas-conversation-conv-main',
        agentType: 'codex',
        mode: 'default',
        cwd: '/repo',
        createdAt: '2026-06-20T01:00:00.000Z',
        sessionState: 'active',
        providerContext: {
          providerId: 'codex',
          threadId: 'legacy-thread',
        },
      }],
    })

    const result = await runSqliteMigration({
      sourceRoot,
      dbPath,
      backup: false,
      now: () => new Date('2026-06-20T02:00:00.000Z'),
    })

    expect(result.stats).toMatchObject({
      sourceSessions: 1,
      importedSessions: 1,
      skippedSessions: 0,
    })
    expect(result.stats.errors).toEqual([])

    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      const restored = readSqlitePersistedSessionsState(db)
      expect(restored.sessions[0]).toMatchObject({
        name: 'commander-atlas-conversation-conv-main',
        sessionType: 'commander',
        creator: { kind: 'commander', id: 'atlas' },
        conversationId: 'conv-main',
      })
    } finally {
      db.close()
    }
  })

  it('refreshes created_at when writing a session over an archived row', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-revive-archived-')
    const dbPath = path.join(dataDir, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      applyHammurabiSqliteSchema(db)
      db.prepare(
        `INSERT INTO agent_runtime_sessions (
           name,
           session_type,
           creator_kind,
           state,
           provider,
           provider_resume_json,
           runtime_state_json,
           cwd,
           created_at,
           updated_at,
           archived_at
         ) VALUES (?, 'commander', 'human', 'archived', 'codex', ?, '{}', '/old-repo', ?, ?, ?)`,
      ).run(
        'reused-session-name',
        JSON.stringify({ providerId: 'codex', threadId: 'old-thread' }),
        '2026-06-19T01:00:00.000Z',
        '2026-06-19T01:05:00.000Z',
        '2026-06-19T01:06:00.000Z',
      )

      writeSqlitePersistedSessionsState(db, {
        sessions: [{
          name: 'reused-session-name',
          sessionType: 'commander',
          creator: { kind: 'human' },
          agentType: 'codex',
          mode: 'default',
          cwd: '/new-repo',
          createdAt: '2026-06-20T01:00:00.000Z',
          sessionState: 'active',
          providerContext: createCodexProviderContext({ threadId: 'new-thread' }),
        }],
      }, '2026-06-20T01:05:00.000Z')

      const row = db.prepare(
        `SELECT state, provider_resume_json, cwd, created_at, updated_at, archived_at
         FROM agent_runtime_sessions
         WHERE name = 'reused-session-name'`,
      ).get() as {
        state: string
        provider_resume_json: string
        cwd: string
        created_at: string
        updated_at: string
        archived_at: string | null
      }
      expect(row).toMatchObject({
        state: 'active',
        cwd: '/new-repo',
        created_at: '2026-06-20T01:00:00.000Z',
        updated_at: '2026-06-20T01:05:00.000Z',
        archived_at: null,
      })
      expect(JSON.parse(row.provider_resume_json)).toMatchObject({ threadId: 'new-thread' })
    } finally {
      db.close()
    }
  })

  it('refuses exited runtime sessions without provider resume metadata', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-skip-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')

    await writeJson(path.join(sourceRoot, 'agents', 'stream-sessions.json'), {
      sessions: [{
        name: 'worker-no-resume',
        sessionType: 'worker',
        creator: { kind: 'human', id: 'user-1' },
        agentType: 'codex',
        mode: 'default',
        cwd: '/repo',
        createdAt: '2026-06-20T01:00:00.000Z',
        sessionState: 'exited',
        providerContext: { providerId: 'codex' },
      }],
    })

    let error: SqliteMigrationRefusedError | null = null
    try {
      await runSqliteMigration({
        sourceRoot,
        dbPath,
        backup: false,
        now: () => new Date('2026-06-20T02:00:00.000Z'),
      })
    } catch (caught) {
      error = caught as SqliteMigrationRefusedError
    }

    expect(error).toBeInstanceOf(SqliteMigrationRefusedError)
    expect(error?.result.stats).toMatchObject({
      sourceSessions: 1,
      importedSessions: 0,
      skippedSessions: 1,
      activeSessions: 0,
      pausedSessions: 0,
      backupPath: null,
    })
    expect(error?.result.stats.errors).toEqual([
      expect.objectContaining({
        sessionName: 'worker-no-resume',
        errorType: 'missing_provider_resume',
      }),
    ])
    await expect(access(error!.result.stats.reportPath!)).resolves.toBeUndefined()
  })

  it('refuses malformed legacy session stores without marking SQLite current', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-malformed-store-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')
    const sessionsPath = path.join(sourceRoot, 'agents', 'stream-sessions.json')
    await mkdir(path.dirname(sessionsPath), { recursive: true })
    await writeFile(sessionsPath, '{"sessions":[', 'utf8')

    let error: SqliteMigrationRefusedError | null = null
    try {
      await runSqliteMigration({
        sourceRoot,
        dbPath,
        backup: false,
        now: () => new Date('2026-06-20T02:00:00.000Z'),
      })
    } catch (caught) {
      error = caught as SqliteMigrationRefusedError
    }

    expect(error).toBeInstanceOf(SqliteMigrationRefusedError)
    expect(error?.result.stats).toMatchObject({
      sourceSessions: 0,
      importedSessions: 0,
      skippedSessions: 0,
      activeSessions: 0,
      pausedSessions: 0,
      backupPath: null,
    })
    expect(error?.result.stats.errors).toEqual([
      expect.objectContaining({
        sourcePath: sessionsPath,
        errorType: 'invalid_legacy_session_store',
      }),
    ])
    await expect(access(error!.result.stats.reportPath!)).resolves.toBeUndefined()
    await expect(access(dbPath)).rejects.toThrow()
  })

  it('refuses malformed legacy session entries without dropping valid sessions silently', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-malformed-entry-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')
    const sessionsPath = path.join(sourceRoot, 'agents', 'stream-sessions.json')

    await writeJson(sessionsPath, {
      sessions: [
        {
          name: 'valid-runtime',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'atlas' },
          agentType: 'codex',
          mode: 'default',
          cwd: '/repo',
          createdAt: '2026-06-20T01:00:00.000Z',
          sessionState: 'active',
          providerContext: { providerId: 'codex', threadId: 'thread-valid' },
        },
        {
          name: 'missing-created-at',
          agentType: 'codex',
          mode: 'default',
          cwd: '/repo',
          sessionState: 'active',
          providerContext: { providerId: 'codex', threadId: 'thread-invalid' },
        },
      ],
    })

    let error: SqliteMigrationRefusedError | null = null
    try {
      await runSqliteMigration({
        sourceRoot,
        dbPath,
        backup: false,
        now: () => new Date('2026-06-20T02:00:00.000Z'),
      })
    } catch (caught) {
      error = caught as SqliteMigrationRefusedError
    }

    expect(error).toBeInstanceOf(SqliteMigrationRefusedError)
    expect(error?.result.stats).toMatchObject({
      sourceSessions: 2,
      importedSessions: 1,
      skippedSessions: 1,
      activeSessions: 1,
      pausedSessions: 0,
      backupPath: null,
    })
    expect(error?.result.stats.errors).toEqual([
      expect.objectContaining({
        sessionName: 'missing-created-at',
        errorType: 'invalid_legacy_session_entry',
      }),
    ])
    await expect(access(error!.result.stats.reportPath!)).resolves.toBeUndefined()
    await expect(access(dbPath)).rejects.toThrow()
  })

  it('does not delete an existing SQLite database with replace until the source validates', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-replace-invalid-source-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      applyHammurabiSqliteSchema(db)
      db.prepare(
        `INSERT INTO agent_runtime_sessions (
           name, session_type, creator_kind, state, provider, provider_resume_json, runtime_state_json, cwd,
           created_at, updated_at
         ) VALUES (
           'existing-runtime', 'commander', 'human', 'active', 'codex',
           '{"providerId":"codex","threadId":"existing"}', '{}', '/repo',
           '2026-06-20T01:00:00.000Z', '2026-06-20T01:00:00.000Z'
         )`,
      ).run()
    } finally {
      db.close()
    }

    const sessionsPath = path.join(sourceRoot, 'agents', 'stream-sessions.json')
    await mkdir(path.dirname(sessionsPath), { recursive: true })
    await writeFile(sessionsPath, '{"sessions":[', 'utf8')

    await expect(runSqliteMigration({
      sourceRoot,
      dbPath,
      backup: false,
      replace: true,
      now: () => new Date('2026-06-20T02:00:00.000Z'),
    })).rejects.toThrow(SqliteMigrationRefusedError)

    const verifyDb = openHammurabiSqliteDatabase(dbPath)
    try {
      const rows = verifyDb.prepare('SELECT name FROM agent_runtime_sessions').all() as Array<{ name: string }>
      expect(rows).toEqual([{ name: 'existing-runtime' }])
    } finally {
      verifyDb.close()
    }
  })

  it('refuses to rewrite a populated SQLite database without replace', async () => {
    const sourceRoot = await makeTempDir('hammurabi-sqlite-migration-existing-')
    const dbPath = path.join(sourceRoot, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      applyHammurabiSqliteSchema(db)
      db.prepare(
        `INSERT INTO agent_runtime_sessions (
           name, session_type, creator_kind, creator_id, conversation_id, spawned_by,
           transport_type, machine_id, state, provider, provider_resume_json, runtime_state_json, cwd,
           created_at, updated_at, archived_at
         ) VALUES (
           'existing-runtime', 'commander', 'commander', 'gaia', NULL, NULL,
           'stream', 'local', 'active', 'codex', '{"providerId":"codex","threadId":"existing"}', '{}',
           '/repo', '2026-06-20T01:00:00.000Z', '2026-06-20T01:00:00.000Z', NULL
         )`,
      ).run()
    } finally {
      db.close()
    }

    await writeJson(path.join(sourceRoot, 'agents', 'stream-sessions.json'), {
      sessions: [{
        name: 'replacement-runtime',
        sessionType: 'commander',
        creator: { kind: 'commander', id: 'gaia' },
        agentType: 'codex',
        mode: 'default',
        cwd: '/repo',
        createdAt: '2026-06-20T02:00:00.000Z',
        sessionState: 'active',
        providerContext: { providerId: 'codex', threadId: 'replacement' },
      }],
    })

    await expect(runSqliteMigration({
      sourceRoot,
      dbPath,
      backup: false,
      now: () => new Date('2026-06-20T03:00:00.000Z'),
    })).rejects.toThrow('Refusing to migrate into existing SQLite database')

    const verifyDb = openHammurabiSqliteDatabase(dbPath)
    try {
      const rows = verifyDb.prepare('SELECT name FROM agent_runtime_sessions').all() as Array<{ name: string }>
      expect(rows).toEqual([{ name: 'existing-runtime' }])
    } finally {
      verifyDb.close()
    }
  })
})
