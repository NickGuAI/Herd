// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useProviderRegistry: vi.fn(),
  useDirectories: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

vi.mock('@/hooks/use-agents', () => ({
  useDirectories: mocks.useDirectories,
}))

vi.mock('@/hooks/use-providers', () => ({
  useProviderRegistry: mocks.useProviderRegistry,
}))

vi.mock('../WizardChatPanel', () => ({
  WizardChatPanel: ({
    onCancel,
    onCreated,
    onBusyChange,
  }: {
    onCancel?: () => void
    onCreated?: () => void
    onBusyChange?: (busy: boolean) => void
  }) => (
    <div data-testid="mock-wizard-chat-panel">
      <h2>Get your AI worker to work</h2>
      <button type="button" data-testid="mock-chat-busy" onClick={() => onBusyChange?.(true)}>
        Mark chat busy
      </button>
      <button type="button" data-testid="mock-chat-created" onClick={() => onCreated?.()}>
        Finish chat
      </button>
      <button type="button" data-testid="mock-chat-cancel" onClick={() => onCancel?.()}>
        Close chat
      </button>
    </div>
  ),
}))

import { CreateCommanderForm } from '../CreateCommanderForm'
import { CreateCommanderWizard } from '../CreateCommanderWizard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

async function flushReact(): Promise<void> {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) {
    throw new Error('Missing HTMLInputElement value setter')
  }
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderWizard(options: {
  onAdd?: (input: { host: string }) => Promise<void>
  onClose?: () => void
  onWizardCreated?: () => Promise<void> | void
  onBusyChange?: (busy: boolean) => void
} = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const onAdd = options.onAdd ?? vi.fn(async () => undefined)
  const onClose = options.onClose ?? vi.fn()
  const onWizardCreated = options.onWizardCreated ?? vi.fn()
  const onBusyChange = options.onBusyChange ?? vi.fn()

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <CreateCommanderWizard
          onAdd={onAdd}
          isPending={false}
          onClose={onClose}
          onWizardCreated={onWizardCreated}
          onBusyChange={onBusyChange}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()

  return { onAdd, onClose, onWizardCreated, onBusyChange }
}

async function renderForm(onAdd = vi.fn(async () => undefined)) {
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
        <CreateCommanderForm
          onAdd={onAdd}
          isPending={false}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()

  return { onAdd }
}

describe('CreateCommanderWizard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchJson.mockReset()
    mocks.useProviderRegistry.mockReset()
    mocks.useDirectories.mockReset()
    mocks.fetchJson.mockResolvedValue({
      defaults: { maxTurns: 25 },
      limits: { maxTurns: 25 },
    })
    mocks.useDirectories.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
    })
    mocks.useProviderRegistry.mockReturnValue({
      data: [
        {
          id: 'claude',
          label: 'Claude',
          eventProvider: 'claude',
          capabilities: {
            supportsAutomation: true,
            supportsCommanderConversation: true,
            supportsWorkerDispatch: true,
            supportsMessageImages: true,
          },
          uiCapabilities: {
            supportsEffort: true,
            supportsAdaptiveThinking: true,
            supportsMaxThinkingTokens: true,
            supportsSkills: true,
            supportsLoginMode: true,
            permissionModes: [],
          },
          availableModels: [
            { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
            { id: 'claude-opus-4-7', label: 'Opus 4.7' },
          ],
        },
        {
          id: 'codex',
          label: 'Codex',
          eventProvider: 'codex',
          capabilities: {
            supportsAutomation: true,
            supportsCommanderConversation: true,
            supportsWorkerDispatch: true,
            supportsMessageImages: true,
          },
          uiCapabilities: {
            supportsEffort: false,
            supportsAdaptiveThinking: false,
            supportsMaxThinkingTokens: false,
            supportsSkills: false,
            supportsLoginMode: true,
            permissionModes: [],
          },
          availableModels: [
            { id: 'gpt-5.4', label: 'GPT-5.4' },
            { id: 'gpt-5.5', label: 'GPT-5.5' },
          ],
        },
      ],
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('opens directly into chat-first commander setup', async () => {
    const { onAdd } = await renderWizard()

    expect(document.body.querySelector('[data-testid="mock-wizard-chat-panel"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Get your AI worker to work')
    expect(document.body.textContent).not.toContain('Choose a creation path')
    expect(document.body.textContent).not.toContain('Quick Create')
    expect(document.body.textContent).not.toContain('Talk to Me')
    expect(document.body.textContent).not.toContain('Advanced')
    expect(document.body.textContent).toContain('Manual setup')
    expect(document.body.textContent).not.toContain('Manual commander setup')
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('exposes a manual commander setup fallback from the chat-first modal', async () => {
    const onAdd = vi.fn(async () => undefined)
    const onClose = vi.fn()
    await renderWizard({ onAdd, onClose })

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Manual setup')
        ?.click()
    })
    await flushReact()

    expect(document.body.querySelector('[data-testid="mock-wizard-chat-panel"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="manual-commander-setup"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Manual commander setup')

    const hostInput = Array.from(document.body.querySelectorAll('input')).find(
      (element): element is HTMLInputElement => element.placeholder === 'host (e.g. my-agent-1)',
    )
    if (!hostInput) {
      throw new Error('Missing manual host input')
    }

    await act(async () => {
      setInputValue(hostInput, 'fallback-agent')
    })
    await flushReact()

    const createButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '+ Create',
    )
    if (!(createButton instanceof HTMLButtonElement)) {
      throw new Error('Missing manual create button')
    }

    await act(async () => {
      createButton.click()
      await flushReact()
    })

    await vi.waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ host: 'fallback-agent' }))
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('wires chat busy, cancel, and created callbacks through the wrapper', async () => {
    const onClose = vi.fn()
    const onWizardCreated = vi.fn()
    const onBusyChange = vi.fn()
    await renderWizard({ onClose, onWizardCreated, onBusyChange })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="mock-chat-busy"]')?.click()
    })
    expect(onBusyChange).toHaveBeenCalledWith(true)

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="mock-chat-created"]')?.click()
      await flushReact()
    })
    expect(onWizardCreated).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    onClose.mockClear()
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="mock-chat-cancel"]')?.click()
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('passes the standalone form host to the directory picker', async () => {
    await renderForm()

    const hostInput = Array.from(document.body.querySelectorAll('input')).find(
      (element): element is HTMLInputElement => element.placeholder === 'host (e.g. my-agent-1)',
    )
    if (!hostInput) {
      throw new Error('Missing host input')
    }

    await act(async () => {
      setInputValue(hostInput, 'mac-mini')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(mocks.useDirectories.mock.calls.some((call) => call[2] === 'mac-mini')).toBe(true)
    })
  })
})
