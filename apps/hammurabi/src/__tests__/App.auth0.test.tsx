// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth0ProviderProps: null as null | {
    authorizationParams?: {
      redirect_uri?: string
    }
  },
  getAccessTokenSilently: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: (props: Record<string, unknown>) => {
    mocks.auth0ProviderProps = props as typeof mocks.auth0ProviderProps
    return <>{props.children as ReactNode}</>
  },
  useAuth0: () => ({
    isLoading: false,
    isAuthenticated: false,
    getAccessTokenSilently: mocks.getAccessTokenSilently,
    logout: mocks.logout,
  }),
}))

vi.mock('@/components/LandingPage', () => ({
  LandingPage: () => null,
}))

vi.mock('@/app/AuthenticatedAppRouter', () => ({
  AuthenticatedAppRouter: () => null,
}))

vi.mock('@/module-registry', () => ({
  moduleComponentBindings: [],
}))

import App from '../App'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderApp(path: string) {
  window.history.replaceState({}, document.title, path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<App />)
    await Promise.resolve()
  })
}

describe('App Auth0 configuration', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.auth0ProviderProps = null
    vi.stubEnv('VITE_AUTH0_DOMAIN', 'auth.example.com')
    vi.stubEnv('VITE_AUTH0_AUDIENCE', 'https://pmai-api')
    vi.stubEnv('VITE_AUTH0_CLIENT_ID', 'client-id')
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
        await Promise.resolve()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    localStorage.clear()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('keeps the Auth0 redirect_uri pinned to origin on deep links', async () => {
    await renderApp('/command-room?commander=gaia&conversation=abc')

    expect(mocks.auth0ProviderProps?.authorizationParams?.redirect_uri).toBe(
      window.location.origin,
    )
  })
})
