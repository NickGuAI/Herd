import { getFullUrl } from './api-base'

const DEFAULT_SIGN_IN_PATH = '/org'
const HEALTH_ENDPOINT = '/api/health'
const CACHE_BYPASS_PARAM = '__herd_auth_reload'

export const PENDING_AUTH_RETURN_TO_KEY = 'herd.pendingAuthReturnTo'
const rawClientBuildVersion = (import.meta.env.VITE_BUILD_COMMIT as string | undefined)?.trim()
export const CLIENT_BUILD_VERSION: string | null = rawClientBuildVersion || null

interface HealthPayload {
  version?: unknown
}

interface BuildGuardWindow {
  location: Pick<Location, 'href' | 'pathname' | 'search' | 'hash' | 'assign'>
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

interface BuildGuardDependencies {
  fetchImpl?: typeof fetch
  window?: BuildGuardWindow
  clientBuildVersion?: string | null
  now?: () => number
}

interface HealthCheckDependencies {
  fetchImpl?: typeof fetch
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readServerVersion(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null
  }

  const version = (payload as HealthPayload).version
  return typeof version === 'string' && version.trim().length > 0
    ? version.trim()
    : null
}

function browserWindow(): BuildGuardWindow {
  return window
}

function readPendingReturnTo(storage: BuildGuardWindow['sessionStorage']): string | null {
  try {
    const value = storage?.getItem(PENDING_AUTH_RETURN_TO_KEY)?.trim() ?? ''
    if (!value) {
      return null
    }
    storage?.removeItem(PENDING_AUTH_RETURN_TO_KEY)
    return value
  } catch {
    return null
  }
}

function writePendingReturnTo(
  storage: BuildGuardWindow['sessionStorage'],
  returnTo: string,
): void {
  try {
    storage?.setItem(PENDING_AUTH_RETURN_TO_KEY, returnTo)
  } catch {
    // Storage can be unavailable in private windows; reloading the current URL
    // still leaves the user on the same page and preserves the visible intent.
  }
}

function buildCacheBypassUrl(win: BuildGuardWindow, now: () => number): string {
  const url = new URL(win.location.href)
  url.searchParams.set(CACHE_BYPASS_PARAM, String(now()))
  return url.toString()
}

async function fetchHealth(fetchImpl: typeof fetch): Promise<Response | null> {
  try {
    return await fetchImpl(getFullUrl(HEALTH_ENDPOINT), { cache: 'no-store' })
  } catch {
    return null
  }
}

export async function isAuthGatewayHealthy(
  dependencies: HealthCheckDependencies = {},
): Promise<boolean> {
  const response = await fetchHealth(dependencies.fetchImpl ?? fetch)
  return Boolean(response?.ok)
}

export function resolveAuthReturnTo(win: BuildGuardWindow = browserWindow()): string {
  const pendingReturnTo = readPendingReturnTo(win.sessionStorage)
  if (pendingReturnTo) {
    return pendingReturnTo
  }

  const { pathname, search, hash } = win.location
  return !pathname || pathname === '/' || pathname === '/welcome'
    ? DEFAULT_SIGN_IN_PATH
    : `${pathname}${search}${hash}`
}

export async function ensureFreshAuthClientBeforeRedirect(
  returnTo: string,
  dependencies: BuildGuardDependencies = {},
): Promise<boolean> {
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const win = dependencies.window ?? browserWindow()
  const clientBuildVersion = dependencies.clientBuildVersion === undefined
    ? CLIENT_BUILD_VERSION
    : dependencies.clientBuildVersion
  const normalizedClientBuildVersion = clientBuildVersion?.trim() ?? ''

  try {
    const response = await fetchHealth(fetchImpl)
    if (response === null) {
      return true
    }
    if (!response.ok) {
      return false
    }

    let serverBuildVersion: string | null = null
    try {
      serverBuildVersion = readServerVersion(await response.json())
    } catch {
      return true
    }

    if (
      serverBuildVersion &&
      normalizedClientBuildVersion.length > 0 &&
      serverBuildVersion !== normalizedClientBuildVersion
    ) {
      writePendingReturnTo(win.sessionStorage, returnTo)
      win.location.assign(buildCacheBypassUrl(win, dependencies.now ?? Date.now))
      return false
    }
  } catch {
    return false
  }

  return true
}
