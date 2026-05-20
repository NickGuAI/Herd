// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionRow } from '../SessionRow'

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderSessionRow({
  selected = true,
  status = 'running',
  approvals = [],
}: {
  selected?: boolean
  status?: string
  approvals?: Parameters<typeof SessionRow>[0]['approvals']
} = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      <SessionRow
        commander={{
          id: 'atlas-id',
          name: 'atlas',
          displayName: 'Atlas',
          status,
          description: 'Engineering commander. Second sentence.',
          avatarUrl: null,
        }}
        selected={selected}
        onClick={vi.fn()}
        approvals={approvals}
      />,
    )
  })
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

describe('SessionRow', () => {
  it('renders sidebar commander avatars as 44px rounded squares', () => {
    renderSessionRow()

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.style.width).toBe('44px')
    expect(avatar?.style.height).toBe('44px')
    expect(avatar?.style.borderRadius).toBe('var(--hv-radius-md)')
  })

  it('renders a name-only row while keeping pending approvals visible', () => {
    renderSessionRow({
      approvals: [{ id: 'approval-1', commanderId: 'atlas-id' }],
    })

    expect(container?.textContent).toContain('atlas')
    expect(container?.textContent).toContain('1 PEND')
    expect(container?.textContent).not.toContain('Engineering commander')
    expect(container?.textContent).not.toContain('engineering commander')
  })

  it('keeps active commanders at full opacity without pulsing', () => {
    renderSessionRow({ selected: false, status: 'running' })

    const button = document.querySelector('[data-testid="commander-row-button"]') as HTMLElement | null
    expect(button?.className).toBe('')
    expect(button?.style.opacity).toBe('1')
  })

  it('dims idle selected commanders without pulse while keeping selection styling', () => {
    renderSessionRow({ selected: true, status: 'idle' })

    const button = document.querySelector('[data-testid="commander-row-button"]') as HTMLElement | null
    expect(button?.className).toBe('')
    expect(button?.style.opacity).toBe('0.58')
  })

  it('dims idle unselected commanders', () => {
    renderSessionRow({ selected: false, status: 'idle' })

    const button = document.querySelector('[data-testid="commander-row-button"]') as HTMLElement | null
    expect(button?.className).toBe('')
    expect(button?.style.opacity).toBe('0.58')
  })
})
