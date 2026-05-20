// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
}))

import {
  useBeginChannelPairing,
  useCompleteChannelPairing,
  useCreateChannelBinding,
  useUpdateChannelBinding,
} from '../hooks/useChannels'

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
let createMutation: ReturnType<typeof useCreateChannelBinding> | null = null
let beginPairingMutation: ReturnType<typeof useBeginChannelPairing> | null = null
let completePairingMutation: ReturnType<typeof useCompleteChannelPairing> | null = null
let updateMutation: ReturnType<typeof useUpdateChannelBinding> | null = null

const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

function Harness() {
  createMutation = useCreateChannelBinding()
  beginPairingMutation = useBeginChannelPairing()
  completePairingMutation = useCompleteChannelPairing()
  updateMutation = useUpdateChannelBinding()
  return null
}

async function renderHookHarness(): Promise<void> {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient! },
        createElement(Harness),
      ),
    )
  })
}

function requestBodyAt(callIndex: number): Record<string, unknown> {
  const init = mocks.fetchJson.mock.calls[callIndex]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
}

beforeEach(async () => {
  originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  mocks.fetchJson.mockImplementation(async (url: string) => {
    if (url.includes('/pairing/challenge-1/complete')) {
      return { id: 'binding-2', provider: 'whatsapp', accountId: 'acct-2' }
    }
    if (url.endsWith('/pairing')) {
      return { id: 'challenge-1', provider: 'whatsapp' }
    }
    return { id: 'binding-1', provider: 'email', accountId: 'assistant@example.com' }
  })
  await renderHookHarness()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  queryClient?.clear()
  container?.remove()
  root = null
  container = null
  queryClient = null
  createMutation = null
  beginPairingMutation = null
  completePairingMutation = null
  updateMutation = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('channel mutation hooks', () => {
  it('keeps URL-owned identifiers out of channel request bodies', async () => {
    await act(async () => {
      await createMutation?.mutateAsync({
        commanderId: 'cmd/alpha',
        provider: 'email',
        accountId: 'assistant@example.com',
        displayName: 'Assistant Email',
        enabled: true,
        config: {
          imapHost: 'imap.gmail.com',
          appPassword: 'secret',
        },
      })
    })

    expect(mocks.fetchJson.mock.calls[0]?.[0]).toBe('/api/commanders/cmd%2Falpha/channels')
    expect(requestBodyAt(0)).toMatchObject({
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      enabled: true,
      config: {
        imapHost: 'imap.gmail.com',
        appPassword: 'secret',
      },
    })
    expect(requestBodyAt(0)).not.toHaveProperty('commanderId')

    await act(async () => {
      await beginPairingMutation?.mutateAsync({
        commanderId: 'cmd/alpha',
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'WhatsApp',
      })
    })

    expect(mocks.fetchJson.mock.calls[1]?.[0]).toBe('/api/commanders/cmd%2Falpha/channels/pairing')
    expect(requestBodyAt(1)).toMatchObject({
      provider: 'whatsapp',
      accountId: 'acct-1',
      displayName: 'WhatsApp',
    })
    expect(requestBodyAt(1)).not.toHaveProperty('commanderId')

    await act(async () => {
      await completePairingMutation?.mutateAsync({
        commanderId: 'cmd/alpha',
        provider: 'whatsapp',
        challengeId: 'challenge-1',
        accountId: 'acct-1',
      })
    })

    expect(mocks.fetchJson.mock.calls[2]?.[0]).toBe('/api/commanders/cmd%2Falpha/channels/pairing/challenge-1/complete')
    expect(requestBodyAt(2)).toMatchObject({
      provider: 'whatsapp',
      accountId: 'acct-1',
    })
    expect(requestBodyAt(2)).not.toHaveProperty('commanderId')
    expect(requestBodyAt(2)).not.toHaveProperty('challengeId')

    await act(async () => {
      await updateMutation?.mutateAsync({
        commanderId: 'cmd/alpha',
        bindingId: 'binding-1',
        enabled: false,
        config: {
          imapMailbox: 'INBOX',
        },
      })
    })

    expect(mocks.fetchJson.mock.calls[3]?.[0]).toBe('/api/commanders/cmd%2Falpha/channels/binding-1')
    expect(requestBodyAt(3)).toMatchObject({
      enabled: false,
      config: {
        imapMailbox: 'INBOX',
      },
    })
    expect(requestBodyAt(3)).not.toHaveProperty('commanderId')
    expect(requestBodyAt(3)).not.toHaveProperty('bindingId')
  })
})
