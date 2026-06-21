import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openHammurabiSqliteDatabase } from '../db/connection'
import { applyHammurabiSqliteSchema } from '../db/schema'
import { createDefaultHeartbeatConfig } from '../../modules/commanders/heartbeat'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_MAX_TURNS,
  type CommanderSession,
} from '../../modules/commanders/store'
import {
  resetActiveRuntimeStateForLaunch,
  shouldStopActiveSessionsOnBoot,
} from '../launch-state-reset'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function buildCommanderSession(
  id: string,
  state: CommanderSession['state'],
): CommanderSession {
  return {
    id,
    host: 'local',
    state,
    created: '2026-06-20T01:00:00.000Z',
    heartbeat: createDefaultHeartbeatConfig(),
    maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
    contextMode: 'fat',
    taskSource: null,
  }
}

describe('launch state reset', () => {
  it('parses the launch reset opt-in environment value', () => {
    expect(shouldStopActiveSessionsOnBoot('1')).toBe(true)
    expect(shouldStopActiveSessionsOnBoot('true')).toBe(true)
    expect(shouldStopActiveSessionsOnBoot('on')).toBe(true)
    expect(shouldStopActiveSessionsOnBoot('0')).toBe(false)
    expect(shouldStopActiveSessionsOnBoot(undefined)).toBe(false)
  })

  it('pauses active SQLite runtime sessions before module init', async () => {
    const dir = await createTempDir('hammurabi-launch-reset-')
    const db = openHammurabiSqliteDatabase(join(dir, 'hammurabi.sqlite'))
    try {
      applyHammurabiSqliteSchema(db)
      const insert = db.prepare(
        `INSERT INTO agent_runtime_sessions (
           name, session_type, creator_kind, creator_id, conversation_id, spawned_by,
           transport_type, machine_id, state, provider, provider_resume_json, runtime_state_json, cwd,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'stream', 'local', ?, 'codex', ?, ?, '/repo', ?, ?, ?)`,
      )
      insert.run(
        'active-runtime',
        'commander',
        'commander',
        'gaia',
        'conv-1',
        null,
        'active',
        JSON.stringify({
          providerId: 'codex',
          threadId: 'thread-active',
          daemonProcess: { processId: 'dead-daemon', mode: 'pipe' },
        }),
        JSON.stringify({
          mode: 'default',
          hadResult: true,
          activeTurnId: 'turn-stale',
          queuedMessages: [{
            id: 'queued-normal',
            text: 'normal queued message',
            priority: 'normal',
            queuedAt: '2026-06-20T01:00:05.000Z',
          }],
          currentQueuedMessage: {
            id: 'direct-current',
            text: 'current direct send',
            displayText: 'current direct send with image',
            images: [{
              mediaType: 'image/png',
              data: 'base64-image-data',
            }],
            clientSendId: 'client-send-1755',
            userEventSubtype: 'image',
            priority: 'high',
            queuedAt: '2026-06-20T01:00:10.000Z',
          },
          pendingDirectSendMessages: [{
            id: 'direct-existing',
            text: 'existing direct send',
            priority: 'high',
            queuedAt: '2026-06-20T01:00:15.000Z',
          }],
        }),
        '2026-06-20T01:00:00.000Z',
        '2026-06-20T01:00:00.000Z',
        null,
      )
      insert.run(
        'paused-runtime',
        'worker',
        'commander',
        'gaia',
        null,
        'active-runtime',
        'paused',
        JSON.stringify({ providerId: 'codex', threadId: 'thread-paused' }),
        '{}',
        '2026-06-20T01:05:00.000Z',
        '2026-06-20T01:05:00.000Z',
        null,
      )
      insert.run(
        'archived-runtime',
        'worker',
        'commander',
        'gaia',
        null,
        'active-runtime',
        'archived',
        JSON.stringify({ providerId: 'codex', threadId: 'thread-archived' }),
        '{}',
        '2026-06-20T01:10:00.000Z',
        '2026-06-20T01:10:00.000Z',
        '2026-06-20T01:11:00.000Z',
      )

      const result = await resetActiveRuntimeStateForLaunch({ sqliteDb: db })

      expect(result).toEqual({
        runtimeSessionsPaused: 1,
        commanderSessionsIdled: 0,
        errors: [],
      })
      const rows = db.prepare(
        'SELECT name, state, archived_at FROM agent_runtime_sessions ORDER BY name ASC',
      ).all() as Array<{ name: string; state: string; archived_at: string | null }>
      expect(rows).toEqual([
        { name: 'active-runtime', state: 'paused', archived_at: null },
        { name: 'archived-runtime', state: 'archived', archived_at: '2026-06-20T01:11:00.000Z' },
        { name: 'paused-runtime', state: 'paused', archived_at: null },
      ])
      const activeRow = db.prepare(
        `SELECT provider_resume_json, runtime_state_json
         FROM agent_runtime_sessions
         WHERE name = 'active-runtime'`,
      ).get() as { provider_resume_json: string; runtime_state_json: string }
      const providerResume = JSON.parse(activeRow.provider_resume_json) as Record<string, unknown>
      const runtimeState = JSON.parse(activeRow.runtime_state_json) as Record<string, unknown>
      expect(providerResume).toMatchObject({ providerId: 'codex', threadId: 'thread-active' })
      expect(providerResume).not.toHaveProperty('daemonProcess')
      expect(runtimeState).toMatchObject({
        mode: 'default',
        hadResult: false,
        queuedMessages: [expect.objectContaining({ id: 'queued-normal' })],
        pendingDirectSendMessages: [
          expect.objectContaining({
            id: 'direct-current',
            displayText: 'current direct send with image',
            images: [{ mediaType: 'image/png', data: 'base64-image-data' }],
            clientSendId: 'client-send-1755',
            userEventSubtype: 'image',
          }),
          expect.objectContaining({ id: 'direct-existing' }),
        ],
      })
      expect(runtimeState).not.toHaveProperty('activeTurnId')
      expect(runtimeState).not.toHaveProperty('currentQueuedMessage')
    } finally {
      db.close()
    }
  })

  it('idles running commander records before module init', async () => {
    const dir = await createTempDir('hammurabi-launch-reset-commanders-')
    const db = openHammurabiSqliteDatabase(join(dir, 'hammurabi.sqlite'))
    const store = new CommanderSessionStore(join(dir, 'sessions.json'))
    try {
      applyHammurabiSqliteSchema(db)
      await store.create(buildCommanderSession('gaia', 'running'))
      await store.create(buildCommanderSession('atlas', 'idle'))
      await store.create(buildCommanderSession('atlas', 'stopped'))

      const result = await resetActiveRuntimeStateForLaunch({
        sqliteDb: db,
        commanderSessionStore: store,
      })

      expect(result).toEqual({
        runtimeSessionsPaused: 0,
        commanderSessionsIdled: 1,
        errors: [],
      })
      await expect(store.get('gaia')).resolves.toMatchObject({ state: 'idle' })
      await expect(store.get('atlas')).resolves.toMatchObject({ state: 'idle' })
      await expect(store.get('atlas')).resolves.toMatchObject({ state: 'stopped' })
    } finally {
      db.close()
    }
  })
})
