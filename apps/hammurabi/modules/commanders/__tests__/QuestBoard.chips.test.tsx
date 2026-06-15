// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestBoard } from '../components/QuestBoard'

const mockQuest = {
  id: 'quest-1',
  status: 'active',
  instruction: 'Inspect qpr module boundaries',
  source: 'manual',
  commanderId: 'commander-1',
  createdAt: '2026-05-15T12:00:00.000Z',
  contract: {
    cwd: '/home/builder/App',
    agentType: 'codex',
    permissionMode: 'default',
  },
  latestNote: 'Use the module graph as the source of truth.',
  artifacts: [
    {
      type: 'github_issue',
      label: 'Issue 1465',
      href: 'https://github.com/NickGuAI/Herd/issues/1465',
    },
  ],
}

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
    useQuery: () => ({
      data: [mockQuest],
      isLoading: false,
      error: null,
    }),
    useMutation: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
    }),
  }
})

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderQuestBoard() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      createElement(QuestBoard, {
        commanders: [{ id: 'commander-1', host: 'atlas' }],
        selectedCommanderId: 'commander-1',
      }),
    )
  })

  return container
}

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
  vi.clearAllMocks()
})

describe('QuestBoard collapsed chips', () => {
  it('renders quests collapsed by default as one-line chips', () => {
    const host = renderQuestBoard()

    expect(host.textContent).toContain('Inspect qpr module boundaries')
    expect(host.textContent).toContain('active')
    expect(host.textContent).not.toContain('/home/builder/App')
    expect(host.textContent).not.toContain('codex')
    expect(host.textContent).not.toContain('Use the module graph as the source of truth.')
    expect(host.textContent).not.toContain('artifacts')
    expect(host.querySelector('button[title="Delete quest"]')).toBeNull()

    const questButton = Array.from(host.querySelectorAll('article button')).find((button) =>
      button.textContent?.includes('Inspect qpr module boundaries'),
    )
    expect(questButton?.className).toContain('hover:bg-ink-wash')
  })

  it('expands the full card when the chip row is clicked', () => {
    const host = renderQuestBoard()
    const questButton = Array.from(host.querySelectorAll('article button')).find((button) =>
      button.textContent?.includes('Inspect qpr module boundaries'),
    )
    expect(questButton, 'Expected quest chip button').toBeDefined()

    flushSync(() => {
      questButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.textContent).toContain('/home/builder/App')
    expect(host.textContent).toContain('codex')
    expect(host.textContent).toContain('Use the module graph as the source of truth.')
    expect(host.textContent).toContain('1 artifact')
    expect(host.querySelector('button[title="Delete quest"]')).not.toBeNull()
  })
})
