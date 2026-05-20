// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '../../types'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import { CheckOnHero } from '../CheckOnHero'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

function createCommander(overrides: Partial<OrgNode> = {}): OrgNode {
  return {
    id: 'cmd-1',
    kind: 'commander',
    parentId: 'founder-1',
    displayName: 'Atlas',
    avatarUrl: null,
    status: 'running',
    costUsd: 0,
    archived: false,
    counts: { activeQuests: 2, activeWorkers: 1, activeChats: 3 },
    questsInFlight: { active: 2, pending: 0 },
    channels: { whatsapp: 1, telegram: 0, discord: 0 },
    activeUiChats: 3,
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

async function renderHero(commander = createCommander()) {
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
        <MemoryRouter initialEntries={['/org']}>
          <Routes>
            <Route
              path="/org"
              element={(
                <>
                  <LocationProbe />
                  <CheckOnHero commander={commander} />
                </>
              )}
            />
            <Route path="/command-room" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

async function findCheckOnButton(): Promise<HTMLButtonElement> {
  let button: HTMLButtonElement | null = null
  await vi.waitFor(() => {
    button = document.body.querySelector<HTMLButtonElement>('[data-testid="commander-check-on-hero"]')
    expect(button).not.toBeNull()
  })
  return button!
}

describe('CheckOnHero', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchJson.mockReset()
    mocks.fetchJson.mockResolvedValue({
      target: {
        routeId: 'command-room.ui',
        path: '/command-room?commander=cmd-1',
        commanderId: 'cmd-1',
        conversationId: null,
      },
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('navigates with the active conversation in the search params when one exists', async () => {
    mocks.fetchJson.mockResolvedValue({
      target: {
        routeId: 'command-room.ui',
        path: '/command-room?commander=cmd-1&conversation=conv-9',
        commanderId: 'cmd-1',
        conversationId: 'conv-9',
      },
    })

    await renderHero()

    const button = await findCheckOnButton()

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent)
        .toBe('/command-room?commander=cmd-1&conversation=conv-9')
    })
    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/org/commanders/cmd-1/check-on-target')
  })

  it('falls back to a commander-only navigation when no active conversation exists', async () => {
    await renderHero()

    const button = await findCheckOnButton()

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent)
        .toBe('/command-room?commander=cmd-1')
    })
  })
})
