// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/contexts/AuthContext'
import type {
  FounderOrgSetupResponse,
  FounderSetupStatus,
  OnboardingStatus,
  OnboardingStepId,
  SeedGaiaOnboardingResponse,
  SeedStarterWorkforceOnboardingResponse,
  SkipStarterWorkforceOnboardingResponse,
} from '../contracts'

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

function onboardingStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  const founderSetup = overrides.founderSetup ?? setupStatus()
  const gaia = overrides.gaia ?? {
    commanderId: null,
    displayName: 'Gaia',
    avatarUrl: '/assets/commanders/gaia-profile.png',
    exists: false,
    conversationId: null,
    defaultProviderId: 'claude',
  }
  const providers = overrides.providers ?? [
    {
      id: 'claude',
      label: 'Claude Code',
      cliBinaryName: 'claude',
      installed: true,
      authConfigured: true,
      authMode: 'login' as const,
      state: 'ready' as const,
      shortAction: 'Ready for local machine execution.',
      verificationCommand: 'claude --version',
      envSourceKey: null,
    },
  ]
  const machines = overrides.machines ?? [
    {
      id: 'local',
      label: 'Local (this server)',
      transport: 'local' as const,
      state: 'ready' as const,
      envFile: '/tmp/.hammurabi-env',
      cwd: null,
      summary: 'This server can run provider CLIs directly.',
    },
  ]
  const starterWorkforce = overrides.starterWorkforce ?? {
    packages: [
      {
        packageId: 'engineering-manager',
        displayName: 'Asina',
        role: 'Engineering Manager',
        summary: 'Owns engineering delivery.',
        installed: false,
        commanderId: null,
      },
      {
        packageId: 'research-intelligence-analyst',
        displayName: 'Einstein',
        role: 'Research Intelligence Analyst',
        summary: 'Owns research synthesis.',
        installed: false,
        commanderId: null,
      },
      {
        packageId: 'general-assistant',
        displayName: 'Alfred',
        role: 'General Assistant',
        summary: 'Owns daily support.',
        installed: false,
        commanderId: null,
      },
    ],
    installedCount: 0,
    totalCount: 3,
    skipped: false,
    complete: false,
  }
  const currentStepId: OnboardingStepId = overrides.currentStepId ?? (
    founderSetup.setupComplete
      ? (gaia.exists ? (starterWorkforce.complete ? 'launch' : 'starter-workforce') : 'gaia')
      : 'founder-org'
  )

  return {
    currentStepId,
    steps: [
      { id: 'instance', label: 'Instance ready', state: 'complete', summary: 'Local Herd app and bootstrap admin are available.' },
      { id: 'founder-org', label: 'Founder + organization', state: founderSetup.setupComplete ? 'complete' : 'current', summary: 'Create the first local operator and org identity.' },
      { id: 'gaia', label: 'Gaia commander', state: gaia.exists ? 'complete' : currentStepId === 'gaia' ? 'current' : 'pending', summary: 'Seed Gaia as the default onboarding commander.' },
      { id: 'starter-workforce', label: 'Starter workforce', state: starterWorkforce.complete ? 'complete' : currentStepId === 'starter-workforce' ? 'current' : 'pending', summary: 'Install the bundled engineering, research, and assistant commanders.' },
      { id: 'providers-machines', label: 'Providers + machines', state: 'complete', summary: 'At least one provider and machine are ready.' },
      { id: 'launch', label: 'Launch', state: currentStepId === 'launch' ? 'current' : 'pending', summary: 'Open the org page or command room.' },
    ],
    founderSetup,
    gaia,
    starterWorkforce,
    providers,
    machines,
    receipt: {
      url: 'http://localhost:20001/org',
      account: 'local bootstrap admin',
      organization: founderSetup.defaultValues.orgDisplayName || null,
      founder: founderSetup.defaultValues.founderDisplayName || null,
      commander: gaia.exists ? gaia.displayName : null,
      machine: 'Local (this server)',
      providerSummary: 'Claude Code ready',
    },
    launchTarget: gaia.commanderId ? `/command-room?commander=${gaia.commanderId}` : '/org',
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
    if (url === '/api/onboarding/status') {
      return Promise.resolve(onboardingStatus())
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
              <Route path="/command-room" element={<LocationProbe />} />
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

async function waitForInput(testId: string): Promise<HTMLInputElement> {
  await vi.waitFor(() => {
    expect(document.body.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)).not.toBeNull()
  })
  return getInput(testId)
}

async function setInputValue(testId: string, value: string) {
  const input = await waitForInput(testId)
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flushReact()
}

async function clickSubmit(times: number = 1) {
  await vi.waitFor(() => {
    expect(document.body.querySelector<HTMLFormElement>('[data-testid="founder-org-setup-form"]')).not.toBeNull()
  })
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
      if (url === '/api/onboarding/status') {
        return Promise.resolve(onboardingStatus())
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

  it('submits founder and org setup, then advances to Gaia setup', async () => {
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
      expect(document.body.textContent).toContain('Gaia, mother of commanders')
    })
  })

  it('seeds Gaia and the starter workforce through backend onboarding actions before launch', async () => {
    const completedFounder = setupStatus({
      setupComplete: true,
      defaultValues: {
        orgDisplayName: 'Gehirn Inc.',
        founderDisplayName: 'Nick Gu',
        founderEmail: 'nick@example.com',
      },
      validationErrors: {},
      nextRoute: '/org',
    })
    const seeded = onboardingStatus({
      currentStepId: 'starter-workforce',
      founderSetup: completedFounder,
      gaia: {
        commanderId: 'commander-gaia',
        displayName: 'Gaia',
        avatarUrl: '/assets/commanders/gaia-profile.png',
        exists: true,
        conversationId: 'conversation-gaia',
        defaultProviderId: 'claude',
      },
      launchTarget: '/command-room?commander=commander-gaia',
    })
    const workforceSeeded = onboardingStatus({
      currentStepId: 'launch',
      founderSetup: completedFounder,
      gaia: seeded.gaia,
      starterWorkforce: {
        packages: seeded.starterWorkforce.packages.map((pkg) => ({
          ...pkg,
          installed: true,
          commanderId: `commander-${pkg.packageId}`,
        })),
        installedCount: 3,
        totalCount: 3,
        skipped: false,
        complete: true,
      },
      launchTarget: '/command-room?commander=commander-gaia',
    })
    let statusResponse = onboardingStatus({
      currentStepId: 'gaia',
      founderSetup: completedFounder,
    })
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/onboarding/status') {
        return Promise.resolve(statusResponse)
      }
      if (url === '/api/onboarding/actions/seed-gaia') {
        statusResponse = seeded
        return Promise.resolve({
          gaia: seeded.gaia,
          status: seeded,
        } satisfies SeedGaiaOnboardingResponse)
      }
      if (url === '/api/onboarding/actions/seed-starter-workforce') {
        statusResponse = workforceSeeded
        return Promise.resolve({
          starterWorkforce: workforceSeeded.starterWorkforce,
          status: workforceSeeded,
        } satisfies SeedStarterWorkforceOnboardingResponse)
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })

    await renderPage()
    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="seed-gaia-submit"]')).not.toBeNull()
    })
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="seed-gaia-submit"]')?.click()
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Starter workforce')
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="seed-starter-workforce-submit"]')?.click()
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Providers and machines')
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="onboarding-step-launch"]')?.click()
    })
    await flushReact()
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="onboarding-launch-submit"]')?.click()
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/command-room?commander=commander-gaia')
    })
  })

  it('can skip starter workforce installation and continue to provider and machine readiness', async () => {
    const completedFounder = setupStatus({
      setupComplete: true,
      defaultValues: {
        orgDisplayName: 'Gehirn Inc.',
        founderDisplayName: 'Nick Gu',
        founderEmail: 'nick@example.com',
      },
      validationErrors: {},
      nextRoute: '/org',
    })
    const initialStatus = onboardingStatus({
      currentStepId: 'starter-workforce',
      founderSetup: completedFounder,
      gaia: {
        commanderId: 'commander-gaia',
        displayName: 'Gaia',
        avatarUrl: '/assets/commanders/gaia-profile.png',
        exists: true,
        conversationId: 'conversation-gaia',
        defaultProviderId: 'claude',
      },
    })
    const skippedStatus = onboardingStatus({
      currentStepId: 'launch',
      founderSetup: completedFounder,
      gaia: initialStatus.gaia,
      starterWorkforce: {
        ...initialStatus.starterWorkforce,
        skipped: true,
        complete: true,
      },
      launchTarget: '/command-room?commander=commander-gaia',
    })
    let statusResponse = initialStatus
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/onboarding/status') {
        return Promise.resolve(statusResponse)
      }
      if (url === '/api/onboarding/actions/skip-starter-workforce') {
        statusResponse = skippedStatus
        return Promise.resolve({
          starterWorkforce: skippedStatus.starterWorkforce,
          status: skippedStatus,
        } satisfies SkipStarterWorkforceOnboardingResponse)
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })

    await renderPage()
    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="skip-starter-workforce-submit"]')).not.toBeNull()
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="skip-starter-workforce-submit"]')?.click()
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Providers and machines')
      expect(document.body.querySelector('[data-testid="provider-readiness-section"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="machine-readiness-section"]')).not.toBeNull()
    })
    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/onboarding/actions/skip-starter-workforce', expect.objectContaining({
      method: 'POST',
    }))
    expect(mocks.fetchJson.mock.calls.some(([url]) => url === '/api/onboarding/actions/seed-starter-workforce')).toBe(false)
  })

  it('renders provider readiness separately from machine readiness', async () => {
    const completedFounder = setupStatus({
      setupComplete: true,
      defaultValues: {
        orgDisplayName: 'Gehirn Inc.',
        founderDisplayName: 'Nick Gu',
        founderEmail: 'nick@example.com',
      },
      validationErrors: {},
      nextRoute: '/org',
    })
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/onboarding/status') {
        return Promise.resolve(onboardingStatus({
          currentStepId: 'providers-machines',
          founderSetup: completedFounder,
          gaia: {
            commanderId: 'commander-gaia',
            displayName: 'Gaia',
            avatarUrl: '/assets/commanders/gaia-profile.png',
            exists: true,
            conversationId: 'conversation-gaia',
            defaultProviderId: 'claude',
          },
          starterWorkforce: {
            packages: [],
            installedCount: 3,
            totalCount: 3,
            skipped: false,
            complete: true,
          },
        }))
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="provider-readiness-section"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="machine-readiness-section"]')).not.toBeNull()
    })
    const providerSection = document.body.querySelector('[data-testid="provider-readiness-section"]')
    const machineSection = document.body.querySelector('[data-testid="machine-readiness-section"]')
    expect(providerSection?.textContent).toContain('Provider readiness')
    expect(providerSection?.querySelector('[data-testid="provider-card-claude"]')).not.toBeNull()
    expect(providerSection?.querySelector('[data-testid="machine-card-local"]')).toBeNull()
    expect(machineSection?.textContent).toContain('Machine readiness')
    expect(machineSection?.querySelector('[data-testid="machine-card-local"]')).not.toBeNull()
    expect(machineSection?.querySelector('[data-testid="provider-card-claude"]')).toBeNull()
  })

  it('renders Gaia with the bundled default headshot during onboarding', async () => {
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/onboarding/status') {
        return Promise.resolve(onboardingStatus({
          currentStepId: 'gaia',
          founderSetup: setupStatus({
            setupComplete: true,
            defaultValues: {
              orgDisplayName: 'Gehirn Inc.',
              founderDisplayName: 'Nick Gu',
              founderEmail: 'nick@example.com',
            },
            validationErrors: {},
            nextRoute: '/org',
          }),
        }))
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLImageElement>('[data-testid="gaia-avatar"]')?.getAttribute('src')).toBe('/assets/commanders/gaia-profile.png')
    })
  })

  it('starts on the backend-derived next incomplete step after refresh', async () => {
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url === '/api/onboarding/status') {
        return Promise.resolve(onboardingStatus({
          currentStepId: 'starter-workforce',
          founderSetup: setupStatus({
            setupComplete: true,
            defaultValues: {
              orgDisplayName: 'Gehirn Inc.',
              founderDisplayName: 'Nick Gu',
              founderEmail: 'nick@example.com',
            },
            validationErrors: {},
            nextRoute: '/org',
          }),
          gaia: {
            commanderId: 'commander-gaia',
            displayName: 'Gaia',
            avatarUrl: '/assets/commanders/gaia-profile.png',
            exists: true,
            conversationId: 'conversation-gaia',
            defaultProviderId: 'claude',
          },
        }))
      }
      return Promise.reject(new Error(`Unexpected fetchJson URL: ${url}`))
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Starter workforce')
    })
    expect(document.body.textContent).not.toContain('Founder and organization')
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
      if (url === '/api/onboarding/status') {
        return Promise.resolve(onboardingStatus({
          founderSetup: setupStatus({
            defaultValues: {
              orgDisplayName: '',
              founderDisplayName: 'Auth0 Founder',
              founderEmail: 'founder@example.com',
            },
          }),
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
    let resolveRequest: (value: FounderOrgSetupResponse) => void = () => {
      throw new Error('pending response resolver was not initialized')
    }
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
      expect(document.body.textContent).toContain('Gaia, mother of commanders')
    })
  })
})
