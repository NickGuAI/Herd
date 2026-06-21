import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendCommanderCostRecord,
  computeLiveSessionMonthlySpendUsd,
  computeCommanderMonthlySpendUsd,
  enforceCommanderCostCap,
  type CommanderCostContext,
} from '../cost-control'
import type { StreamJsonEvent } from '../../agents/types'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeCommanderTranscript(
  dataDir: string,
  commanderId: string,
  transcriptId: string,
  lines: string[],
): Promise<void> {
  const sessionsDir = join(dataDir, commanderId, 'sessions')
  await mkdir(sessionsDir, { recursive: true })
  await writeFile(
    join(sessionsDir, `${transcriptId}.jsonl`),
    lines.join('\n'),
    'utf8',
  )
}

function turnEnd(time: string, totalCostUsd: number): unknown {
  return {
    schemaVersion: 2,
    id: `event-${time}`,
    time,
    source: {
      provider: 'codex',
      backend: 'cli',
    },
    ev: {
      type: 'turn.end',
      status: 'completed',
      result: {
        total_cost_usd: totalCostUsd,
      },
    },
  }
}

function buildConversationSessionName(commanderId: string, conversationId: string): string {
  return `commander-${commanderId}-conversation-${conversationId}`
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  )
})

describe('computeCommanderMonthlySpendUsd', () => {
  it('sums only current-month ledger rows for the requested commander', async () => {
    const dataDir = await createTempDir('hammurabi-commander-ledger-cost-')
    const commanderId = '00000000-0000-4000-a000-0000000000aa'
    const otherCommanderId = '00000000-0000-4000-a000-0000000000bb'
    await appendCommanderCostRecord({ commanderDataDir: dataDir }, {
      commanderId,
      conversationId: 'main',
      costUsd: 10,
      occurredAt: '2026-05-31T23:59:59.000Z',
    })
    await appendCommanderCostRecord({ commanderDataDir: dataDir }, {
      commanderId,
      conversationId: 'main',
      costUsd: 2.25,
      occurredAt: '2026-06-18T12:00:00.000Z',
    })
    await appendCommanderCostRecord({ commanderDataDir: dataDir }, {
      commanderId: otherCommanderId,
      conversationId: 'main',
      costUsd: 99,
      occurredAt: '2026-06-18T12:00:00.000Z',
    })

    await expect(
      computeCommanderMonthlySpendUsd(
        { commanderDataDir: dataDir, now: () => new Date('2026-06-18T16:00:00.000Z') },
        commanderId,
      ),
    ).resolves.toBe(2.25)
  })

  it('does not scan transcript JSONL files during runtime cost calculation', async () => {
    const dataDir = await createTempDir('hammurabi-commander-no-transcript-scan-')
    const commanderId = '00000000-0000-4000-a000-0000000000cc'
    await writeCommanderTranscript(dataDir, commanderId, 'main', [
      JSON.stringify(turnEnd('2026-06-18T12:00:00.000Z', 99)),
    ])

    await expect(
      computeCommanderMonthlySpendUsd(
        { commanderDataDir: dataDir, now: () => new Date('2026-06-18T16:00:00.000Z') },
        commanderId,
      ),
    ).resolves.toBe(0)
  })

  it('adds active in-memory conversation session usage to ledger spend', async () => {
    const dataDir = await createTempDir('hammurabi-commander-active-cost-')
    const commanderId = '00000000-0000-4000-a000-0000000000dd'
    const conversationId = '11111111-1111-4111-8111-111111111111'
    await appendCommanderCostRecord({ commanderDataDir: dataDir }, {
      commanderId,
      conversationId,
      costUsd: 2.25,
      occurredAt: '2026-06-18T12:00:00.000Z',
    })
    const liveSessionName = buildConversationSessionName(commanderId, conversationId)

    await expect(
      computeCommanderMonthlySpendUsd(
        {
          commanderDataDir: dataDir,
          now: () => new Date('2026-06-18T16:00:00.000Z'),
          conversationStore: {
            listByCommander: async () => [{ id: conversationId, commanderId }],
          },
          sessionsInterface: {
            getSession: (name) => name === liveSessionName
              ? { usage: { costUsd: 0.75 } }
              : undefined,
          },
        },
        commanderId,
      ),
    ).resolves.toBe(3)
  })

  it('does not carry previous-month active session spend into the current month', async () => {
    const liveSession = {
      createdAt: '2026-06-30T23:45:00.000Z',
      usage: { costUsd: 7 },
      events: [
        turnEnd('2026-06-30T23:50:00.000Z', 7) as StreamJsonEvent,
      ],
    }

    expect(
      computeLiveSessionMonthlySpendUsd(
        liveSession,
        new Date('2026-07-01T00:10:00.000Z'),
      ),
    ).toBe(0)
  })

  it('counts only current-month active session cost deltas after a UTC month boundary', async () => {
    const liveSession = {
      createdAt: '2026-06-30T23:45:00.000Z',
      usage: { costUsd: 8.25 },
      events: [
        turnEnd('2026-06-30T23:50:00.000Z', 7) as StreamJsonEvent,
        turnEnd('2026-07-01T00:05:00.000Z', 8.25) as StreamJsonEvent,
      ],
    }

    expect(
      computeLiveSessionMonthlySpendUsd(
        liveSession,
        new Date('2026-07-01T00:10:00.000Z'),
      ),
    ).toBe(1.25)
  })

  it('blocks cost-capped commanders using ledger plus active in-memory usage', async () => {
    const dataDir = await createTempDir('hammurabi-commander-live-cap-')
    const commanderId = '00000000-0000-4000-a000-0000000000ee'
    const conversationId = '22222222-2222-4222-8222-222222222222'
    await appendCommanderCostRecord({ commanderDataDir: dataDir }, {
      commanderId,
      conversationId,
      costUsd: 2.25,
      occurredAt: '2026-06-18T12:00:00.000Z',
    })
    const liveSessionName = buildConversationSessionName(commanderId, conversationId)
    const result = await enforceCommanderCostCap({
      commanderDataDir: dataDir,
      now: () => new Date('2026-06-18T16:00:00.000Z'),
      sessionStore: {
        get: async () => ({ costCapUsd: 3 }) as never,
      },
      conversationStore: {
        listByCommander: async () => [{ id: conversationId, commanderId }],
      },
      sessionsInterface: {
        getSession: (name) => name === liveSessionName
          ? { usage: { costUsd: 1 } }
          : undefined,
      },
    } as CommanderCostContext, commanderId)

    expect(result).toEqual({
      ok: false,
      status: 402,
      body: {
        error: `Commander "${commanderId}" has reached its monthly spend cap.`,
        reason: 'budget_blocked',
        commanderId,
        costCapUsd: 3,
        monthlyCostUsd: 3.25,
        window: 'calendar_month_utc',
      },
    })
  })
})
