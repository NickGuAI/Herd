import { describe, expect, it, vi } from 'vitest'
import { CodexSessionRuntime } from '../runtime'

function createRuntime() {
  return new CodexSessionRuntime(
    'codex-runtime-test',
    undefined,
    () => [],
    30_000,
    vi.fn(),
  )
}

type RuntimeProtocolHarness = {
  handleProtocolMessage(payloadText: string): void
}

describe('CodexSessionRuntime notification routing', () => {
  it('routes Codex account rate limit notifications without thread identifiers', () => {
    const runtime = createRuntime()
    const listener = vi.fn()
    runtime.addNotificationListener('thread-1', listener)

    const params = {
      rateLimits: {
        primary: { usedPercent: 99, resetsAt: 1781798203 },
        secondary: { usedPercent: 21 },
        planType: 'pro',
      },
    }
    const protocolHarness = runtime as unknown as RuntimeProtocolHarness
    protocolHarness.handleProtocolMessage(JSON.stringify({
      method: 'account/rateLimits/updated',
      params,
    }))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      method: 'account/rateLimits/updated',
      params,
    }))
  })
})

describe('CodexSessionRuntime teardown archiving', () => {
  it('leaves Codex threads resumable by default during teardown', async () => {
    const runtime = createRuntime()
    const sendRequest = vi.spyOn(runtime, 'sendRequest').mockResolvedValue({})

    await runtime.teardown({ threadId: 'thread-1', reason: 'transient teardown' })

    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('archives a Codex thread only when teardown explicitly requests it', async () => {
    const runtime = createRuntime()
    const sendRequest = vi.spyOn(runtime, 'sendRequest').mockResolvedValue({})

    await runtime.teardown({ threadId: 'thread-1', reason: 'Session deleted', archive: true })

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest).toHaveBeenCalledWith('thread/archive', { threadId: 'thread-1' })
  })

  it('never archives during process-exit teardown', () => {
    const runtime = createRuntime()
    const sendRequest = vi.spyOn(runtime, 'sendRequest').mockResolvedValue({})

    runtime.teardownOnProcessExit()

    expect(sendRequest).not.toHaveBeenCalled()
  })
})
