// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FrontendModuleBinding } from '@/types'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'
import type { FounderSetupStatus } from '@modules/onboarding/contracts'

const mocks = vi.hoisted(() => ({
  useFounderSetupStatus: vi.fn(),
}))

vi.mock('@modules/onboarding/hooks/useFounderOnboarding', () => ({
  useFounderSetupStatus: mocks.useFounderSetupStatus,
}))

vi.mock('@/surfaces/desktop/Shell', () => ({
  Shell: ({ children, modules }: { children: ReactNode; modules: unknown[] }) => (
    <div data-testid="shell" data-module-count={modules.length}>{children}</div>
  ),
}))

import { AuthenticatedAppRouter } from '../AuthenticatedAppRouter'

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

function createBinding(routeId: string, componentKey: string, testId: string): FrontendModuleBinding {
  return {
    name: testId,
    routeId,
    componentKey,
    component: async () => ({
      default: () => <div data-testid={testId}>{testId}</div>,
    }),
  }
}

const testBindings: FrontendModuleBinding[] = [
  createBinding('onboarding.ui', 'modules/onboarding/page', 'welcome-page'),
  createBinding('command-room.ui', 'modules/command-room/page', 'command-room-page'),
  createBinding('org.ui', 'modules/org/page', 'org-page'),
  createBinding('automations.ui', 'modules/automations/page', 'automations-page'),
]

const moduleGraph: HammurabiModuleGraphResponse = {
  modules: [
    {
      id: 'onboarding',
      label: 'Onboarding',
      status: 'public',
      summary: 'Founder setup.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['desktop'],
        routes: [{
          id: 'onboarding.ui',
          path: '/welcome',
          componentKey: 'modules/onboarding/page',
          surfaces: ['desktop'],
        }],
      },
    },
    {
      id: 'command-room',
      label: 'Command Room',
      status: 'public',
      summary: 'Commander workspace.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['desktop'],
        routes: [{
          id: 'command-room.ui',
          path: '/command-room',
          componentKey: 'modules/command-room/page',
          surfaces: ['desktop'],
        }],
        redirects: [{
          id: 'command-room.legacy-automations-redirect',
          from: '/command-room/automations',
          toRouteId: 'automations.ui',
        }],
      },
    },
    {
      id: 'org',
      label: 'Org',
      status: 'public',
      summary: 'Organization.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['desktop', 'mobile'],
        routes: [{
          id: 'org.ui',
          path: '/org',
          componentKey: 'modules/org/page',
          surfaces: ['desktop', 'mobile'],
        }],
      },
    },
    {
      id: 'automations',
      label: 'Automations',
      status: 'public',
      summary: 'Automation dashboard.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['mobile'],
        routes: [{
          id: 'automations.ui',
          path: '/automations',
          componentKey: 'modules/automations/page',
          surfaces: ['mobile'],
        }],
      },
    },
  ],
  routes: [],
  parsers: [],
  websockets: [],
  storage: [],
  nav: [
    {
      moduleId: 'org',
      routeId: 'org.ui',
      path: '/org',
      label: 'Org',
      icon: 'Users',
      group: 'primary',
      hidden: false,
      surfaces: ['desktop', 'mobile'],
      order: 10,
    },
    {
      moduleId: 'command-room',
      routeId: 'command-room.ui',
      path: '/command-room',
      label: 'Command Room',
      icon: 'RadioTower',
      group: 'primary',
      hidden: false,
      surfaces: ['desktop'],
      order: 20,
    },
    {
      moduleId: 'automations',
      routeId: 'automations.ui',
      path: '/automations',
      label: 'Automations',
      icon: 'CalendarClock',
      group: 'primary',
      hidden: false,
      surfaces: ['mobile'],
      order: 30,
    },
  ],
  providers: [],
}

function setupStatus(overrides: Partial<FounderSetupStatus> = {}): FounderSetupStatus {
  return {
    setupComplete: true,
    defaultValues: {
      orgDisplayName: '',
      founderDisplayName: '',
      founderEmail: '',
    },
    validationErrors: {},
    nextRoute: '/org',
    ...overrides,
  }
}

async function renderRouter(initialEntry: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AuthenticatedAppRouter componentBindings={testBindings} moduleGraph={moduleGraph} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

describe('AuthenticatedAppRouter', () => {
  beforeEach(() => {
    mocks.useFounderSetupStatus.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    queryClient?.clear()
    queryClient = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('keeps existing founders in the normal shell and does not show onboarding', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: setupStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/command-room')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="shell"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="command-room-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="welcome-page"]')).toBeNull()
  })

  it('registers the top-level automations route inside the shell', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: setupStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/automations')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="shell"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="automations-page"]')).not.toBeNull()
    })
  })

  it('routes completed onboarding visits back to org', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: setupStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/welcome')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="org-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="command-room-page"]')).toBeNull()
  })

  it('redirects the legacy command-room automations path to the top-level route', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: setupStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/command-room/automations')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="automations-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="command-room-page"]')).toBeNull()
  })

  it('routes missing-founder sessions to onboarding before the shell mounts', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: setupStatus({ setupComplete: false, nextRoute: '/welcome' }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/command-room')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="welcome-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="shell"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="command-room-page"]')).toBeNull()
  })
})
