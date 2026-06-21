import { describe, expect, it } from 'vitest'
import {
  AUTH_HEADERS,
  INTERNAL_AUTH_HEADERS,
  createMockPtySpawner,
  installMockCodexSidecar,
  startServer,
} from './routes-test-harness'

describe('create session creator wiring', () => {
  it('defaults API-created sessions to a human creator', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'human-session-01',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        sessionName: 'human-session-01',
        mode: 'default',
        sessionType: 'worker',
        creator: { kind: 'human', id: 'api-key' },
        transportType: 'pty',
        agentType: 'claude',
        host: undefined,
        created: true,
      })
    } finally {
      await server.close()
    }
  })

  it('accepts explicit non-human creator + sessionType for internal callers', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'cron-session-01',
          mode: 'default',
          sessionType: 'cron',
          creator: { kind: 'cron', id: 'nightly-health-check' },
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        sessionName: 'cron-session-01',
        mode: 'default',
        sessionType: 'cron',
        creator: { kind: 'cron', id: 'nightly-health-check' },
        transportType: 'pty',
        agentType: 'claude',
        host: undefined,
        created: true,
      })
    } finally {
      await server.close()
    }
  })

  // Issue #1223: external callers attempting commander attribution on the
  // legacy /api/agents/sessions route are pointed at the new canonical
  // /api/commanders/:id/workers route (URL-baked commander identity). The
  // 403 message must specifically reference the new route so operators
  // hitting this gate find the right alternative.
  it('rejects external commander-creator with a message pointing at the canonical commander dispatch route', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'external-commander-attempt',
          mode: 'default',
          sessionType: 'worker',
          creator: { kind: 'commander', id: 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e' },
        }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('/api/commanders/:id/workers')
      expect(body.error).toContain('URL-baked commander identity')
    } finally {
      await server.close()
    }
  })

  it('defaults explicit worker creates without transportType to stream and preserves permissionMode', async () => {
    const sidecar = installMockCodexSidecar()
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'explicit-worker-stream',
          agentType: 'codex',
          sessionType: 'worker',
          permissionMode: 'bypassPermissions',
          cwd: '/tmp',
          task: 'Run without falling back to a pty',
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        sessionName: 'explicit-worker-stream',
        mode: 'bypassPermissions',
        sessionType: 'worker',
        creator: { kind: 'human', id: 'api-key' },
        transportType: 'stream',
        agentType: 'codex',
        host: undefined,
        created: true,
      })
      expect(spawner.spawn).not.toHaveBeenCalled()
    } finally {
      await server.close()
      await sidecar.closeServer()
    }
  })

  it('rejects autonomous permission modes for the default Claude provider', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'explicit-worker-unsupported-mode',
          sessionType: 'worker',
          permissionMode: 'bypassPermissions',
          cwd: '/tmp',
          task: 'This should not report bypass mode for Claude.',
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'permissionMode "bypassPermissions" is not supported by provider claude. Expected one of: default',
      })
      expect(spawner.spawn).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('rejects explicit worker creates that request pty transport', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'explicit-worker-pty',
          sessionType: 'worker',
          transportType: 'pty',
          cwd: '/tmp',
          task: 'This task would be dropped by a pty worker',
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'sessionType "worker" requires transportType "stream" on /api/agents/sessions',
      })
      expect(spawner.spawn).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})
