import { describe, expect, it, vi } from 'vitest'
import { AutomationQuestEventBus } from '../quest-event-bus'
import { AutomationScheduler, type CronScheduler } from '../scheduler'
import type { AutomationStore } from '../store'

function createSchedulerHarness() {
  const jobs: Array<{ stop: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; name?: string }> = []
  const scheduler: CronScheduler = {
    schedule(_expression, _task, options) {
      const job = {
        stop: vi.fn(),
        destroy: vi.fn(),
        name: options?.name,
      }
      jobs.push(job)
      return {
        ...job,
        getNextRun: () => null,
      }
    },
    validate: () => true,
  }
  const store = {
    ensureLoaded: vi.fn(async () => undefined),
    list: vi.fn(async () => [
      {
        id: 'scheduled-automation',
        trigger: 'schedule',
        schedule: '* * * * *',
        status: 'active',
      },
    ]),
  } as unknown as AutomationStore
  const questEventBus = new AutomationQuestEventBus()
  const automationScheduler = new AutomationScheduler({
    scheduler,
    store,
    questEventBus,
  })

  return { automationScheduler, jobs, questEventBus, store }
}

describe('AutomationScheduler lifecycle', () => {
  it('shutdown stops automation jobs, internal jobs, and quest-event subscriptions', async () => {
    const { automationScheduler, jobs, questEventBus, store } = createSchedulerHarness()

    await automationScheduler.initialize()
    automationScheduler.registerInternalSchedule('maintenance', '* * * * *', () => undefined)

    expect(jobs.map((job) => job.name)).toEqual(['automation-scheduled-automation', 'maintenance'])

    automationScheduler.shutdown()

    expect(jobs[0]?.stop).toHaveBeenCalledTimes(1)
    expect(jobs[0]?.destroy).toHaveBeenCalledTimes(1)
    expect(jobs[1]?.stop).toHaveBeenCalledTimes(1)
    expect(jobs[1]?.destroy).toHaveBeenCalledTimes(1)

    questEventBus.emit({
      event: 'completed',
      commanderId: 'commander-1',
      questId: 'quest-1',
      completedAt: '2026-05-14T00:00:00.000Z',
    })
    expect(jobs[0]?.stop).toHaveBeenCalledTimes(1)
    expect(store.list).toHaveBeenCalledTimes(1)
  })
})
