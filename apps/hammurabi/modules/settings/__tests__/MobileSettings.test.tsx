import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useFounderProfile: vi.fn(),
  useMachines: vi.fn(),
  usePolicySettings: vi.fn(),
  useTelemetrySummary: vi.fn(),
  useTheme: vi.fn(),
  useUpdatePolicySettings: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@modules/operators/hooks/useFounderProfile', () => ({
  useFounderProfile: mocks.useFounderProfile,
}))

vi.mock('@/hooks/use-agents', () => ({
  useMachines: mocks.useMachines,
}))

vi.mock('@/hooks/use-action-policies', () => ({
  usePolicySettings: mocks.usePolicySettings,
  useUpdatePolicySettings: mocks.useUpdatePolicySettings,
}))

vi.mock('@/hooks/use-telemetry', () => ({
  useTelemetrySummary: mocks.useTelemetrySummary,
}))

vi.mock('@/lib/theme-context', () => ({
  useTheme: mocks.useTheme,
}))

vi.mock('@modules/telemetry/components/TelemetryPreviewCard', () => ({
  default: () => createElement('div', { 'data-testid': 'telemetry-preview' }, 'TelemetryPreview'),
}))

import { MobileSettings } from '../MobileSettings'
import { MOBILE_SETTINGS_SECTIONS, getMobileSettingsPath } from '../mobile-settings-sections'

function renderMobileSettings(initialEntry = '/command-room/settings'): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(MobileSettings),
    ),
  )
}

describe('MobileSettings', () => {
  beforeEach(() => {
    mocks.useAuth.mockReset()
    mocks.useFounderProfile.mockReset()
    mocks.useMachines.mockReset()
    mocks.usePolicySettings.mockReset()
    mocks.useTelemetrySummary.mockReset()
    mocks.useTheme.mockReset()
    mocks.useUpdatePolicySettings.mockReset()

    mocks.useAuth.mockReturnValue({ signOut: vi.fn(), user: null })
    mocks.useFounderProfile.mockReturnValue({ data: null })
    mocks.useMachines.mockReturnValue({ data: [], isLoading: false, error: null })
    mocks.usePolicySettings.mockReturnValue({
      data: {
        timeoutMinutes: 15,
        timeoutAction: 'block',
        standingApprovalExpiryDays: 14,
      },
      isLoading: false,
      error: null,
    })
    mocks.useTelemetrySummary.mockReturnValue({ data: null, isLoading: false, error: null })
    mocks.useTheme.mockReturnValue({
      theme: 'light',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
      isLoading: false,
      isSaving: false,
    })
    mocks.useUpdatePolicySettings.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('prefers the persisted founder profile over the transient auth user identity', () => {
    mocks.useAuth.mockReturnValue({
      signOut: vi.fn(),
      user: {
        name: 'Google Oauth2 106050570920402391077',
        email: 'google-oauth2|106050570920402391077@auth0.local',
        picture: 'https://example.com/auth0.png',
      },
    })
    mocks.useFounderProfile.mockReturnValue({
      data: {
        id: 'founder-1',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
        avatarUrl: '/api/operators/founder/avatar',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    })

    const html = renderMobileSettings()

    expect(html).toContain('Nick Gu')
    expect(html).toContain('nick@example.com')
    expect(html).toContain('/api/operators/founder/avatar')
    expect(html).not.toContain('Google Oauth2 106050570920402391077')
  })

  it('keeps all settings rows inside the mobile settings route', () => {
    const html = renderMobileSettings('/command-room/settings?surface=capacitor')

    for (const section of MOBILE_SETTINGS_SECTIONS) {
      expect(html).toContain(`href="${getMobileSettingsPath(section.id)}?surface=capacitor"`)
    }

    expect(html).toContain('Machines')
    expect(html).not.toContain('Runtime')
    expect(html).not.toContain('/api-keys#appearance')
    expect(html).not.toContain('/api-keys#about')
    expect(html).not.toContain('/policies#notifications')
  })

  it('renders telemetry from the backend summary hook on the mobile telemetry panel', () => {
    mocks.useTelemetrySummary.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        costToday: 1.25,
        costWeek: 3.5,
        costMonth: 10,
        inputTokensToday: 120,
        inputTokensWeek: 120,
        inputTokensMonth: 120,
        outputTokensToday: 80,
        outputTokensWeek: 80,
        outputTokensMonth: 80,
        totalTokensToday: 200,
        totalTokensWeek: 200,
        totalTokensMonth: 200,
        activeSessions: 2,
        totalSessions: 5,
        topModels: [{ model: 'gpt-5.5', cost: 1.25, calls: 4 }],
        topAgents: [],
        dailyCosts: [],
      },
    })

    const html = renderMobileSettings('/command-room/settings/telemetry')

    expect(html).toContain('Telemetry')
    expect(html).toContain('$1.25')
    expect(html).toContain('2 active / 5 total')
    expect(html).toContain('gpt-5.5')
  })

  it('renders notification settings from the policy settings hook', () => {
    const html = renderMobileSettings('/command-room/settings/notifications')

    expect(html).toContain('Notifications')
    expect(html).toContain('Timeout action')
    expect(html).toContain('value="15"')
    expect(html).toContain('value="14"')
  })

  it('renders machines from the machine registry hook', () => {
    mocks.useMachines.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        {
          id: 'macmini',
          label: 'Mac Mini',
          host: '100.64.1.1',
          cwd: '/Users/nick/App',
        },
      ],
    })

    const html = renderMobileSettings('/command-room/settings/machines')

    expect(html).toContain('Machines')
    expect(html).toContain('Mac Mini')
    expect(html).toContain('100.64.1.1')
    expect(html).not.toContain('Runtime')
  })

  it('renders appearance from the shared theme context', () => {
    mocks.useTheme.mockReturnValue({
      theme: 'dark',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
      isLoading: false,
      isSaving: false,
    })

    const html = renderMobileSettings('/command-room/settings/appearance')

    expect(html).toContain('Appearance')
    expect(html).toContain('Light')
    expect(html).toContain('Dark')
    expect(html).toContain('bg-sumi-black')
  })
})
