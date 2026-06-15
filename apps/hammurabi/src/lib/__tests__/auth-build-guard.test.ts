import { describe, expect, it, vi } from 'vitest'
import {
  ensureFreshAuthClientBeforeRedirect,
  PENDING_AUTH_RETURN_TO_KEY,
  resolveAuthReturnTo,
} from '../auth-build-guard'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
  }
}

function createWindow(path: string) {
  const url = new URL(path, 'https://herd.gehirn.ai')
  return {
    location: {
      href: url.toString(),
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign: vi.fn(),
    },
    sessionStorage: createStorage(),
  }
}

describe('auth build guard', () => {
  it('preserves deep-link return state when the loaded auth client is stale', async () => {
    const win = createWindow('/command-room?commander=gaia')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ version: 'server-sha' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const isFresh = await ensureFreshAuthClientBeforeRedirect(
      '/command-room?commander=gaia',
      {
        fetchImpl,
        window: win,
        clientBuildVersion: 'client-sha',
        now: () => 1234,
      },
    )

    expect(isFresh).toBe(false)
    expect(win.sessionStorage.setItem).toHaveBeenCalledWith(
      PENDING_AUTH_RETURN_TO_KEY,
      '/command-room?commander=gaia',
    )
    expect(win.location.assign).toHaveBeenCalledWith(
      'https://herd.gehirn.ai/command-room?commander=gaia&__hammurabi_auth_reload=1234',
    )
  })

  it('allows Auth0 redirect without reloading when client and server builds match', async () => {
    const win = createWindow('/command-room?commander=gaia')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ version: 'same-sha' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const isFresh = await ensureFreshAuthClientBeforeRedirect(
      '/command-room?commander=gaia',
      {
        fetchImpl,
        window: win,
        clientBuildVersion: 'same-sha',
      },
    )

    expect(isFresh).toBe(true)
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('allows Auth0 redirect without reloading when the client build is unknown', async () => {
    const win = createWindow('/command-room?commander=gaia')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ version: 'server-sha' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const isFresh = await ensureFreshAuthClientBeforeRedirect(
      '/command-room?commander=gaia',
      {
        fetchImpl,
        window: win,
        clientBuildVersion: null,
      },
    )

    expect(isFresh).toBe(true)
    expect(win.sessionStorage.setItem).not.toHaveBeenCalled()
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('blocks Auth0 redirect while gateway health is unavailable', async () => {
    const win = createWindow('/command-room?commander=gaia')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Bad Gateway', { status: 502 }),
    )

    const isFresh = await ensureFreshAuthClientBeforeRedirect(
      '/command-room?commander=gaia',
      {
        fetchImpl,
        window: win,
        clientBuildVersion: 'client-sha',
      },
    )

    expect(isFresh).toBe(false)
    expect(win.sessionStorage.setItem).not.toHaveBeenCalled()
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('allows Auth0 redirect when the health probe is unreachable', async () => {
    const win = createWindow('/command-room?commander=gaia')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    const isFresh = await ensureFreshAuthClientBeforeRedirect(
      '/command-room?commander=gaia',
      {
        fetchImpl,
        window: win,
        clientBuildVersion: 'client-sha',
      },
    )

    expect(isFresh).toBe(true)
    expect(win.sessionStorage.setItem).not.toHaveBeenCalled()
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('allows Auth0 redirect when gateway is healthy but build payload is malformed', async () => {
    const win = createWindow('/command-room?commander=gaia')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ok', { status: 200 }),
    )

    const isFresh = await ensureFreshAuthClientBeforeRedirect(
      '/command-room?commander=gaia',
      {
        fetchImpl,
        window: win,
        clientBuildVersion: 'client-sha',
      },
    )

    expect(isFresh).toBe(true)
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('uses pending return state instead of the cache-bypass URL after reload', () => {
    const win = createWindow('/command-room?commander=gaia&__hammurabi_auth_reload=1234')
    win.sessionStorage.setItem(PENDING_AUTH_RETURN_TO_KEY, '/command-room?commander=gaia')

    expect(resolveAuthReturnTo(win)).toBe('/command-room?commander=gaia')
    expect(win.sessionStorage.removeItem).toHaveBeenCalledWith(PENDING_AUTH_RETURN_TO_KEY)
  })
})
