// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useApiKeys: vi.fn(),
  useCreateApiKey: vi.fn(),
  useRevokeApiKey: vi.fn(),
  useOpenAITranscriptionSettings: vi.fn(),
  useGeminiImageGenerationSettings: vi.fn(),
  useSetOpenAITranscriptionKey: vi.fn(),
  useClearOpenAITranscriptionKey: vi.fn(),
  useSetGeminiImageGenerationKey: vi.fn(),
  useClearGeminiImageGenerationKey: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@/hooks/use-api-keys', () => ({
  useApiKeys: mocks.useApiKeys,
  useCreateApiKey: mocks.useCreateApiKey,
  useRevokeApiKey: mocks.useRevokeApiKey,
  useOpenAITranscriptionSettings: mocks.useOpenAITranscriptionSettings,
  useGeminiImageGenerationSettings: mocks.useGeminiImageGenerationSettings,
  useSetOpenAITranscriptionKey: mocks.useSetOpenAITranscriptionKey,
  useClearOpenAITranscriptionKey: mocks.useClearOpenAITranscriptionKey,
  useSetGeminiImageGenerationKey: mocks.useSetGeminiImageGenerationKey,
  useClearGeminiImageGenerationKey: mocks.useClearGeminiImageGenerationKey,
}))

vi.mock('../components/AccountProfileCard', () => ({
  AccountProfileCard: () => <form data-testid="account-profile-card">Account Profile</form>,
}))

vi.mock('@modules/org-identity/components/OrgIdentityCard', () => ({
  OrgIdentityCard: () => <form data-testid="org-identity-card">Org Identity</form>,
}))

import ApiKeysPage from '../page'

let root: Root | null = null
let container: HTMLDivElement | null = null

function resetHookMocks() {
  mocks.useAuth.mockReturnValue({
    signOut: vi.fn(),
    user: { name: 'Nick Gu', email: 'nick@example.com' },
  })
  mocks.useApiKeys.mockReturnValue({
    data: [
      {
        id: 'key-1',
        name: 'Telemetry Ingest',
        prefix: 'hmrb_live',
        createdBy: 'Nick',
        createdAt: '2026-05-01T00:00:00.000Z',
        lastUsedAt: null,
        scopes: ['agents:read'],
      },
    ],
    isLoading: false,
    error: null,
  })
  mocks.useCreateApiKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useRevokeApiKey.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useOpenAITranscriptionSettings.mockReturnValue({
    data: { configured: true, updatedAt: '2026-05-01T00:00:00.000Z' },
    error: null,
  })
  mocks.useGeminiImageGenerationSettings.mockReturnValue({
    data: { configured: false, updatedAt: null },
    error: null,
  })
  mocks.useSetOpenAITranscriptionKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useClearOpenAITranscriptionKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useSetGeminiImageGenerationKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useClearGeminiImageGenerationKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
}

describe('ApiKeysPage MagicBento settings layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHookMocks()
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
  })

  it('renders settings sections inside the Sumi-e MagicBento grid with desktop spans', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<ApiKeysPage />)
      await Promise.resolve()
    })

    expect(document.querySelector('[data-testid="settings-magic-bento"]')?.className).toContain('hv-magic-bento')
    expect(document.querySelector('[data-testid="settings-bento-org"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-account"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-transcription"]')?.getAttribute('data-bento-span')).toBe('3')
    expect(document.querySelector('[data-testid="settings-bento-image-generation"]')?.getAttribute('data-bento-span')).toBe('3')
    expect(document.querySelector('[data-testid="settings-bento-managed-keys"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-sign-out"]')?.getAttribute('data-bento-span')).toBe('3')
    expect(document.querySelector('[data-testid="settings-bento-create-key"]')?.getAttribute('data-bento-span')).toBe('9')
    expect(document.body.textContent).toContain('Managed Keys')
    expect(document.body.textContent).toContain('Create Key')
  })
})
