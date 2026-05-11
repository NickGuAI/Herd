// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DismissibleOverlay } from '../DismissibleOverlay'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderOverlay({
  onClose,
  dismissible = true,
}: {
  onClose: () => void
  dismissible?: boolean
}): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <DismissibleOverlay open onClose={onClose} dismissible={dismissible}>
        <button type="button" data-testid="inner-button">X</button>
      </DismissibleOverlay>,
    )
    await Promise.resolve()
  })
}

describe('DismissibleOverlay', () => {
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
        await Promise.resolve()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
  })

  it('calls onClose once when the outer container receives a mouse down', async () => {
    const onClose = vi.fn()
    await renderOverlay({ onClose })

    const overlay = document.body.querySelector<HTMLElement>('[data-testid="dismissible-overlay"]')
    expect(overlay).not.toBeNull()

    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when an interactive child receives a mouse down', async () => {
    const onClose = vi.fn()
    await renderOverlay({ onClose })

    const button = document.body.querySelector<HTMLElement>('[data-testid="inner-button"]')
    expect(button).not.toBeNull()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn()
    await renderOverlay({ onClose })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close from outside mouse down when dismissible is false', async () => {
    const onClose = vi.fn()
    await renderOverlay({ onClose, dismissible: false })

    const overlay = document.body.querySelector<HTMLElement>('[data-testid="dismissible-overlay"]')
    expect(overlay).not.toBeNull()

    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })
})

