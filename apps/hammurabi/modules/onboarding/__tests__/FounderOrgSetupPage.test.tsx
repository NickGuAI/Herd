// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/contexts/AuthContext'
import type { FounderOrgSetupResponse, FounderSetupStatus } from '../contracts'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import { FounderOrgSetupPage } from '../FounderOrgSetupPage'

let root: Root | null = null
let container: HTMLDivElement | null = null

function setupStatus(overrides: Partial<FounderSetupStatus> = {}): FounderSetupStatus {
  return {
    setupComplete: false,
    defaultValues: {
      orgDisplayName: '',
      founderDisplayName: '',
      founderEmail: '',
    },
    validationErrors: {
      orgDisplayName: 'Org display name is required.',
      founderDisplayName: 'Founder display name is required.',
      founderEmail: 'Founder email is required.',
    },
    nextRoute: '/welcome',
    ...overrides,
  }
}

function setupResponse(overrides: Partial<FounderOrgSetupResponse> = {}): FounderOrgSetupResponse {
  return {
    operator: {
      id: 'founder-1',
      kind: 'founder',
      displayName: 'Nick Gu',
      email: 'nick@example.com',
      avatarUrl: null,
      createdAt: '2026-05-05T00:00:00.000Z',
    },
    orgIdentity: {
      name: 'Gehirn Inc.',
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:00.000Z',
    },
    nextRoute: '/org',
    ...overrides,
  }
}

function mockSetupPost(response: FounderOrgSetupResponse | Promise<FounderOrgSetupResponse>) {
  mocks.fetchJson.mockImplementation((url: string) => {
    if (url === '/api/org/setup-status') {
      return Promise.resolve(setupStatus())
    }
    if (url === '/api/org') {
      return Promise.resolve(response)
    }
    return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
  })
}

async function flushReact() {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

async function renderPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/welcome']}>
          <AuthProvider signOut={() => {}} user={undefined}>
            <Routes>
              <Route path="/welcome" element={<FounderOrgSetupPage />} />
              <Route path="/org" element={<LocationProbe />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await flushReact()
}

function getInput(testId: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
  if (!input) {
    throw new Error(`Missing input ${testId}`)
  }
  return input
}

async function setInputValue(testId: string, value: string) {
  const input = getInput(testId)
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flushReact()
}

async function clickSubmit(times: number = 1) {
  const form = document.body.querySelector<HTMLFormElement>('[data-testid="founder-org-setup-form"]')
  if (!form) {
    throw new Error('Missing setup form')
  }

  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
  })
  await flushReact()
}

describe('FounderOrgSetupPage', () => {
  beforeEach(() => {
    mocks.fetchJson.mockReset()
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/org/setup-status') {
        return Promise.resolve(setupStatus())
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      await flushReact()
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('submits founder and org setup, then routes to the org page', async () => {
    mockSetupPost(setupResponse())

    await renderPage()
    await setInputValue('org-display-name-input', 'Gehirn Inc.')
    await setInputValue('founder-display-name-input', 'Nick Gu')
    await setInputValue('founder-email-input', 'nick@example.com')
    await clickSubmit()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/org', expect.objectContaining({
        method: 'POST',
      }))
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/org', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }))
    const postCall = mocks.fetchJson.mock.calls.find(([url]) => url === '/api/org')
    const request = postCall?.[1] as { body?: string }
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      displayName: 'Gehirn Inc.',
      founder: {
        displayName: 'Nick Gu',
        email: 'nick@example.com',
      },
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/org')
    })
  })

  it('shows inline validation errors and blocks invalid submission', async () => {
    await renderPage()
    await setInputValue('org-display-name-input', 'Gehirn Inc.')
    await setInputValue('founder-display-name-input', 'Nick Gu')
    await setInputValue('founder-email-input', 'nick-at-example.com')
    await clickSubmit()

    expect(document.body.textContent).toContain('Founder email must be a valid email address.')
    expect(mocks.fetchJson).not.toHaveBeenCalledWith('/api/org', expect.anything())
  })

  it('seeds founder defaults from the backend setup status contract', async () => {
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/org/setup-status') {
        return Promise.resolve(setupStatus({
          defaultValues: {
            orgDisplayName: '',
            founderDisplayName: 'Auth0 Founder',
            founderEmail: 'founder@example.com',
          },
        }))
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(getInput('founder-display-name-input').value).toBe('Auth0 Founder')
      expect(getInput('founder-email-input').value).toBe('founder@example.com')
    })
  })

  it('locks duplicate clicks so double-submit only issues one POST', async () => {
    let resolveRequest: ((value: FounderOrgSetupResponse) => void) | null = null
    const pendingResponse = new Promise<FounderOrgSetupResponse>((resolve) => {
      resolveRequest = resolve
    })
    mockSetupPost(pendingResponse)

    await renderPage()
    await setInputValue('org-display-name-input', 'Gehirn Inc.')
    await setInputValue('founder-display-name-input', 'Nick Gu')
    await setInputValue('founder-email-input', 'nick@example.com')
    await clickSubmit(2)

    expect(mocks.fetchJson.mock.calls.filter(([url]) => url === '/api/org')).toHaveLength(1)

    resolveRequest?.(setupResponse())

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/org')
    })
  })
})
