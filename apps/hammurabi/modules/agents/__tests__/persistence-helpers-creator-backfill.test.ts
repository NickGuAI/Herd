import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultCommanderConversationId } from '../../commanders/store'
import { migrateLegacyPersistedSessionSources } from '../legacy-session-source-migration'
import type { PersistedSessionsState } from '../types'

function makeLegacyExitedEntry(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    agentType: 'claude',
    mode: 'default',
    cwd: '/tmp/legacy-session',
    createdAt: '2026-04-20T00:00:00.000Z',
    sessionState: 'exited',
    hadResult: true,
    providerContext: {
      providerId: 'claude',
      sessionId: `claude-${name}`,
    },
    events: [
      {
        type: 'result',
        subtype: 'success',
        timestamp: '2026-04-20T00:05:00.000Z',
        total_cost_usd: 0.01,
      },
    ],
    ...overrides,
  }
}

describe('persisted session creator backfill', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('backfills creator + sessionType once and persists the upgraded state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-backfill-'))
    const sessionStorePath = join(dir, 'stream-sessions.json')
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    try {
      const legacyState: PersistedSessionsState = {
        sessions: [
          makeLegacyExitedEntry('command-room-nightly') as never,
          makeLegacyExitedEntry('sentinel-watchdog') as never,
          makeLegacyExitedEntry('worker-1710000000000', {
            parentSession: 'commander-cmdr-atlas',
          }) as never,
          makeLegacyExitedEntry('commander-cmdr-borealis') as never,
          makeLegacyExitedEntry('session-plain', {
            sessionCategory: 'regular',
          }) as never,
        ],
      }
      await writeFile(sessionStorePath, JSON.stringify(legacyState, null, 2), 'utf8')

      const { state, changed } = await migrateLegacyPersistedSessionSources(sessionStorePath, legacyState)

      expect(changed).toBe(true)
      expect(state.sessions).toEqual([
        expect.objectContaining({
          name: 'command-room-nightly',
          sessionType: 'cron',
          creator: { kind: 'cron', id: '<unknown-cron-task>' },
        }),
        expect.objectContaining({
          name: 'sentinel-watchdog',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: '<unknown-sentinel>' },
        }),
        expect.objectContaining({
          name: 'worker-1710000000000',
          sessionType: 'worker',
          creator: { kind: 'commander', id: 'cmdr-atlas' },
          spawnedBy: 'commander-cmdr-atlas',
        }),
        expect.objectContaining({
          name: 'commander-cmdr-borealis',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-borealis' },
          conversationId: buildDefaultCommanderConversationId('cmdr-borealis'),
        }),
        expect.objectContaining({
          name: 'session-plain',
          sessionType: 'worker',
          creator: { kind: 'human', id: '<unknown-user>' },
        }),
      ])

      expect(consoleInfo.mock.calls.length).toBeGreaterThanOrEqual(5)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
