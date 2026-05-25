// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionComposer } from '../SessionComposer'

const speechRecognitionMock = {
  isListening: false,
  transcript: '',
  startListening: vi.fn(),
  stopListening: vi.fn(),
  isSupported: true,
}

const composerAbilitiesMock = vi.hoisted(() => ({
  customAbilitiesEnabled: false,
  addCustomAbility: vi.fn(),
  removeCustomAbility: vi.fn(),
  useComposerAbilities: vi.fn(() => ({
    abilities: [
      {
        id: 'create-quests',
        label: 'Create Quests',
        prompt: 'Load quests, ask for acceptance criteria when missing, and add drift detection.',
        enabled: true,
        source: 'default',
      },
      {
        id: 'think-hard',
        label: 'Think Hard',
        prompt: 'Think ultra hard internally and keep the user-visible answer concise.',
        enabled: true,
        source: 'default',
      },
    ],
    settings: {
      defaultAbilities: [],
      customAbilities: [],
      customAbilitiesEnabled: composerAbilitiesMock.customAbilitiesEnabled,
    },
    customAbilitiesEnabled: composerAbilitiesMock.customAbilitiesEnabled,
    addCustomAbility: composerAbilitiesMock.addCustomAbility,
    removeCustomAbility: composerAbilitiesMock.removeCustomAbility,
    isLoading: false,
    isSaving: false,
  })),
}))

vi.mock('@/hooks/use-openai-transcription', () => ({
  useOpenAITranscriptionConfig: () => ({ data: { openaiConfigured: false } }),
  useOpenAITranscription: () => ({
    isSupported: false,
    isListening: false,
    transcript: '',
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-speech-recognition', () => ({
  useSpeechRecognition: () => speechRecognitionMock,
}))

vi.mock('@/hooks/use-composer-abilities', () => ({
  useComposerAbilities: composerAbilitiesMock.useComposerAbilities,
}))

vi.mock('../SkillsPicker', () => ({
  SkillsPicker: ({ visible }: { visible: boolean }) => (
    <div data-testid="skills-picker" data-visible={String(visible)} />
  ),
}))

type ComposerProps = ComponentProps<typeof SessionComposer>

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    sessionName: 'commander-atlas',
    theme: 'dark',
    onSend: vi.fn(() => true),
    onQueue: vi.fn(() => true),
    ...overrides,
  }
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(<SessionComposer {...buildProps(overrides)} />)
  })
}

function composerRow(): HTMLElement {
  const row = document.body.querySelector('.composer-row')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector(`button[aria-label="${label}"]`)
  expect(button, `Expected button with aria-label ${label}`).not.toBeNull()
  return button as HTMLButtonElement
}

function setDraftText(value: string) {
  const textarea = document.body.querySelector('textarea')
  expect(textarea).not.toBeNull()

  flushSync(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    descriptor?.set?.call(textarea, value)
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    textarea?.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  speechRecognitionMock.isListening = false
  speechRecognitionMock.transcript = ''
  speechRecognitionMock.isSupported = true
  speechRecognitionMock.startListening.mockReset()
  speechRecognitionMock.stopListening.mockReset()
  composerAbilitiesMock.customAbilitiesEnabled = false
  composerAbilitiesMock.addCustomAbility.mockReset()
  composerAbilitiesMock.removeCustomAbility.mockReset()
  composerAbilitiesMock.useComposerAbilities.mockClear()
})

afterEach(() => {
  if (root) {
    flushSync(() => {
      root?.unmount()
    })
  }

  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('SessionComposer', () => {
  it('does not render the composer-mode-toggle', async () => {
    renderComposer()

    expect(document.body.querySelector('.composer-mode-toggle')).toBeNull()
  })

  it('does not render a markdown preview', async () => {
    renderComposer()
    setDraftText('Preview mode is gone')

    expect(document.body.querySelector('textarea')).not.toBeNull()
    expect(document.body.querySelector('.composer-preview-markdown')).toBeNull()
  })

  it('ignores Cmd+Shift+P after the preview shortcut was removed', async () => {
    renderComposer()
    setDraftText('Stay in the textarea')

    flushSync(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'P',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }))
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    expect(textarea?.value).toBe('Stay in the textarea')
    expect(document.body.querySelector('.composer-preview-markdown')).toBeNull()
  })

  it('renders composer abilities in the mobile variant when queue access is unavailable', async () => {
    renderComposer({ variant: 'mobile' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(5)
    expect(findButtonByLabel('Add to chat')).toBeDefined()
    expect(findButtonByLabel('Enable Create Quests ability')).toBeDefined()
    expect(findButtonByLabel('Enable Think Hard ability')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(findButtonByLabel('Send message')).toBeDefined()
    expect(document.body.querySelector('button[aria-label="Add custom composer ability"]')).toBeNull()
  })

  it('renders the mobile queue button and opens the queue panel with controls', async () => {
    const onClearQueue = vi.fn()
    const onMoveQueuedMessage = vi.fn()
    const onRemoveQueuedMessage = vi.fn()

    renderComposer({
      variant: 'mobile',
      queueSnapshot: {
        currentMessage: null,
        items: [{
          id: 'queued-1',
          text: 'Investigate the mobile shell gap',
          priority: 'normal',
          queuedAt: '2026-04-21T15:00:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      },
      onClearQueue,
      onMoveQueuedMessage,
      onRemoveQueuedMessage,
    })

    const queueButton = Array.from(composerRow().querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.trim() === 'Queue 1/8')
    expect(queueButton).toBeTruthy()

    flushSync(() => {
      ;(queueButton as HTMLButtonElement).click()
    })

    const panel = document.body.querySelector('[data-testid="queue-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Investigate the mobile shell gap')
    expect(panel?.textContent).toContain('Clear')
    expect(document.body.querySelector('button[aria-label="Move queued message 1 up"]')).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="Move queued message 1 down"]')).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="Remove queued message 1"]')).not.toBeNull()
  })

  it('sends from the mobile primary action when the session is idle', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
      onQueue,
    })
    setDraftText('Ship the mobile redesign')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    expect(onSend).toHaveBeenCalledWith({ text: 'Ship the mobile redesign', images: undefined })
    expect(onQueue).not.toHaveBeenCalled()
  })

  it('clears the mobile draft immediately after an async send is accepted', async () => {
    const onSend = vi.fn(() => Promise.resolve(true))

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
    })
    setDraftText('Clear this after tapping send')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea?.value).toBe('')
    expect(onSend).toHaveBeenCalledWith({ text: 'Clear this after tapping send', images: undefined })
  })

  it('keeps the mobile draft when send is rejected synchronously', async () => {
    const onSend = vi.fn(() => false)

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
    })
    setDraftText('Do not clear this')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea?.value).toBe('Do not clear this')
    expect(onSend).toHaveBeenCalledWith({ text: 'Do not clear this', images: undefined })
  })

  it('sends workspace file, directory, and annotation context as structured payload', async () => {
    const onSend = vi.fn(() => true)

    renderComposer({
      onSend,
      contextFilePaths: ['docs/spec.md'],
      contextDirectoryPaths: ['src'],
      contextFileAnnotations: [{
        id: 'annotation-1',
        path: 'docs/spec.md',
        body: 'Please tighten this section.',
        quote: null,
        range: null,
      }],
    })
    setDraftText('Review this')

    flushSync(() => {
      findButtonByLabel('Send').click()
    })

    expect(onSend).toHaveBeenCalledWith({
      text: 'Review this',
      images: undefined,
      context: {
        filePaths: ['docs/spec.md'],
        directoryPaths: ['src'],
        fileAnnotations: [{
          path: 'docs/spec.md',
          body: 'Please tighten this section.',
          quote: null,
          range: null,
        }],
      },
    })
  })

  it('queues from the mobile primary action while streaming without calling send', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue,
    })
    setDraftText('Queue this follow-up')

    flushSync(() => {
      findButtonByLabel('Add to queue').click()
    })

    expect(onQueue).toHaveBeenCalledWith({ text: 'Queue this follow-up', images: undefined })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps the mobile primary action sendable while streaming when queue drafts are unsupported', async () => {
    const onSend = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue: undefined,
    })
    setDraftText('Keep follow-up send enabled')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    expect(onSend).toHaveBeenCalledWith({ text: 'Keep follow-up send enabled', images: undefined })
  })

  it('keeps the desktop abilities inside the existing action row', async () => {
    renderComposer({ variant: 'desktop' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(7)
    expect(findButtonByLabel('Attach image')).toBeDefined()
    expect(findButtonByLabel('Skills')).toBeDefined()
    expect(findButtonByLabel('Enable Create Quests ability')).toBeDefined()
    expect(findButtonByLabel('Enable Think Hard ability')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(document.body.textContent).toContain('Queue')
    expect(document.body.querySelector('button[aria-label="Add custom composer ability"]')).toBeNull()
  })

  it('applies the selected Create Quests ability to the next send payload without losing context', async () => {
    const onSend = vi.fn(() => true)

    renderComposer({
      onSend,
      contextFilePaths: ['docs/spec.md'],
    })
    setDraftText('Break this into implementation work')

    flushSync(() => {
      findButtonByLabel('Enable Create Quests ability').click()
    })
    flushSync(() => {
      findButtonByLabel('Send').click()
    })

    expect(onSend).toHaveBeenCalledWith({
      text: expect.stringContaining('[Composer abilities]'),
      images: undefined,
      context: {
        filePaths: ['docs/spec.md'],
      },
    })
    const payload = onSend.mock.calls[0]?.[0] as { text: string }
    expect(payload.text).toContain('Create Quests: Load quests')
    expect(payload.text).toContain('[User message]\nBreak this into implementation work')
  })

  it('applies the selected Think Hard ability to the mobile queue payload', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue,
    })
    setDraftText('Compare the options')

    flushSync(() => {
      findButtonByLabel('Enable Think Hard ability').click()
    })
    flushSync(() => {
      findButtonByLabel('Add to queue').click()
    })

    expect(onQueue).toHaveBeenCalledWith({
      text: expect.stringContaining('Think Hard: Think ultra hard internally'),
      images: undefined,
    })
    const payload = onQueue.mock.calls[0]?.[0] as { text: string }
    expect(payload.text).toContain('[User message]\nCompare the options')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('opens the queue panel from the desktop queue button', async () => {
    renderComposer({
      variant: 'desktop',
      queueSnapshot: {
        currentMessage: null,
        items: [{
          id: 'queued-desktop-1',
          text: 'Queue from desktop composer',
          priority: 'normal',
          queuedAt: '2026-05-15T14:00:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      },
    })

    const queueButton = findButtonByLabel('Open queue')
    expect(queueButton.textContent).toBe('Queue 1/8')

    flushSync(() => {
      queueButton.click()
    })

    const panel = document.body.querySelector('[data-testid="queue-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Queue from desktop composer')
    expect(panel?.textContent).toContain('Press Tab')
    expect(panel?.textContent).toContain('Clear')
  })

  it('queues the current draft from the queue panel', async () => {
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'desktop',
      onQueue,
      queueSnapshot: {
        currentMessage: null,
        items: [],
        totalCount: 0,
        maxSize: 8,
      },
    })
    setDraftText('Queue from the sheet')

    flushSync(() => {
      findButtonByLabel('Open queue').click()
    })

    const queueDraftButton = findButtonByLabel('Queue current draft')
    expect(queueDraftButton.textContent).toContain('Queue this draft')

    flushSync(() => {
      queueDraftButton.click()
    })

    expect(onQueue).toHaveBeenCalledWith({ text: 'Queue from the sheet', images: undefined })
    expect(document.body.querySelector('[data-testid="queue-panel"]')).toBeNull()
  })
})
