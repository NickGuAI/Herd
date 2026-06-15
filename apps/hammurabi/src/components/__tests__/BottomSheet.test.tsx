// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import BottomSheet from '../BottomSheet'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderSheet(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <BottomSheet open onClose={() => undefined}>
        <div data-testid="sheet-content">Panel content</div>
      </BottomSheet>,
    )
    await Promise.resolve()
  })
}

describe('BottomSheet', () => {
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
    document.documentElement.classList.remove('hv-light', 'hv-dark')
  })

  it('applies the active Herd theme class to the portaled panel root', async () => {
    document.documentElement.classList.add('hv-dark')

    await renderSheet()

    const themedRoot = document.body
      .querySelector('[data-testid="sheet-content"]')
      ?.closest('.hv-dark')
    expect(themedRoot).not.toBeNull()
    expect(themedRoot?.textContent).toContain('Panel content')
  })
})
