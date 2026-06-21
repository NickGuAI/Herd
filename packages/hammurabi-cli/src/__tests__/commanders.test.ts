import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runCommandersCli } from '../index.js'

interface BufferWriter {
  writer: { write: (chunk: string) => boolean }
  read: () => string
}

function createBufferWriter(): BufferWriter {
  let buffer = ''
  return {
    writer: {
      write(chunk: string): boolean {
        buffer += chunk
        return true
      },
    },
    read(): string {
      return buffer
    },
  }
}

const config = createHammurabiConfig({
  endpoint: 'https://herd.gehirn.ai',
  apiKey: 'hmrb_test_key',
  agents: ['codex'],
  configuredAt: new Date('2026-03-01T00:00:00.000Z'),
})

describe('runCommandersCli', () => {
  it('dispatches a commander worker with an explicit permission mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sessionName: 'worker-codex-1', host: 'gpu-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runCommandersCli(
      [
        'workers',
        'dispatch',
        '--commander',
        'cmdr-atlas',
        '--host',
        'gpu-1',
        '--agent',
        'codex',
        '--task',
        'Ship the worker dispatch fix',
        '--cwd',
        '/tmp/worktree-a',
        '--name',
        'worker-codex-1',
        '--permission-mode',
        'bypassPermissions',
        '--skip-validation',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Worker dispatched: worker-codex-1')
    expect(stdout.read()).toContain('Host: gpu-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://herd.gehirn.ai/api/commanders/cmdr-atlas/workers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          name: 'worker-codex-1',
          host: 'gpu-1',
          agentType: 'codex',
          task: 'Ship the worker dispatch fix',
          cwd: '/tmp/worktree-a',
          permissionMode: 'bypassPermissions',
        }),
      }),
    )
  })

  it('accepts a hostless local dispatch response with the legacy name field', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: 'worker-local-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runCommandersCli(
      [
        'workers',
        'dispatch',
        '--commander',
        'cmdr-atlas',
        '--host',
        'local',
        '--agent',
        'codex',
        '--cwd',
        '/home/builder/App',
        '--name',
        'worker-local-1',
        '--skip-validation',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Worker dispatched: worker-local-1')
    expect(stdout.read()).toContain('Host: local')
  })

  it('accepts a null local host response with the canonical sessionName field', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sessionName: 'worker-local-2', host: null }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runCommandersCli(
      [
        'workers',
        'dispatch',
        '--commander',
        'cmdr-atlas',
        '--host',
        'local',
        '--agent',
        'codex',
        '--cwd',
        '/home/builder/App',
        '--name',
        'worker-local-2',
        '--skip-validation',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Worker dispatched: worker-local-2')
    expect(stdout.read()).toContain('Host: local')
  })

  it('rejects successful dispatch responses without a worker name', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ host: 'local' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stderr = createBufferWriter()

    const exitCode = await runCommandersCli(
      [
        'workers',
        'dispatch',
        '--commander',
        'cmdr-atlas',
        '--host',
        'local',
        '--agent',
        'codex',
        '--name',
        'worker-local-missing-name',
        '--skip-validation',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain(
      'Worker dispatch response was malformed: expected a JSON object with a string sessionName or name.',
    )
  })

  it('rejects invalid permission modes before dispatching', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const exitCode = await runCommandersCli(
      [
        'workers',
        'dispatch',
        '--commander',
        'cmdr-atlas',
        '--host',
        'gpu-1',
        '--agent',
        'codex',
        '--permission-mode',
        'dangerouslySkipPermissions',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
