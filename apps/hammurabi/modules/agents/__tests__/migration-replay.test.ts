import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openHammurabiSqliteDatabase } from '../../../server/db/connection'
import { applyHammurabiSqliteSchema } from '../../../server/db/schema'
import { AUTH_HEADERS, startServer } from './routes-test-harness'

describe('agent runtime session SQLite replay', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores a paused worker runtime session from agent_runtime_sessions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-sqlite-replay-'))
    const sqliteDb = openHammurabiSqliteDatabase(join(dir, 'hammurabi.sqlite'))
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString()

    try {
      applyHammurabiSqliteSchema(sqliteDb)
      sqliteDb.prepare(
        `INSERT INTO agent_runtime_sessions (
           name,
           session_type,
           creator_kind,
           creator_id,
           conversation_id,
           spawned_by,
           transport_type,
           machine_id,
           state,
           provider,
           provider_resume_json,
           cwd,
           created_at,
           updated_at,
           archived_at
         ) VALUES (?, 'worker', 'commander', ?, NULL, ?, 'stream', 'local', 'paused', 'claude', ?, ?, ?, ?, NULL)`,
      ).run(
        'worker-1710000000000',
        'cmdr-atlas',
        'commander-cmdr-atlas',
        JSON.stringify({
          providerId: 'claude',
          sessionId: 'claude-worker-paused',
        }),
        '/tmp/legacy-worker',
        createdAt,
        createdAt,
      )

      const server = await startServer({ sqliteDb, autoResumeSessions: true })
      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'worker-1710000000000',
            state: 'paused',
            sessionType: 'worker',
            creator: { kind: 'commander', id: 'cmdr-atlas' },
            spawnedBy: 'commander-cmdr-atlas',
            machine: expect.objectContaining({
              id: 'local',
              known: true,
            }),
            allowedActions: expect.objectContaining({
              resume: true,
              archive: true,
            }),
          }),
        ]))
      } finally {
        await server.close()
      }
    } finally {
      sqliteDb.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
