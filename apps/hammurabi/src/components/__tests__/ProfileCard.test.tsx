// @vitest-environment jsdom

import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileCard } from '../ProfileCard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

describe('ProfileCard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('passes through button props and renders commander card structure', async () => {
    const onClick = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <ProfileCard
          name="Atlas"
          title="Commander"
          handle="@atlas"
          status="Running"
          statusAdornment={<span data-testid="status-dot" />}
          aria-pressed="true"
          data-testid="commander-tile"
          data-commander-card="cmd-1"
          className="is-selected"
          onClick={onClick}
        />,
      )
    })

    const card = document.body.querySelector<HTMLButtonElement>('[data-testid="commander-tile"]')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('data-commander-card')).toBe('cmd-1')
    expect(card?.getAttribute('aria-pressed')).toBe('true')
    expect(card?.getAttribute('aria-label')).toBe('Atlas, Commander')
    expect(card?.className).toContain('is-selected')
    expect(card?.textContent).toContain('Atlas')
    expect(card?.textContent).toContain('@atlas')
    expect(card?.textContent).toContain('Running')
    expect(document.body.querySelector('.hv-profile-card-details')).not.toBeNull()
    expect(document.body.querySelector('.hv-profile-card-name')?.textContent).toBe('Atlas')
    expect(document.body.querySelector('.hv-profile-card-title')?.textContent).toBe('Commander')
    expect(document.body.querySelector('.hv-profile-card-portrait-fallback')?.textContent).toBe('')
    expect(document.body.querySelector('.hv-profile-card-mini-avatar')?.textContent).toBe('')
    expect(document.body.querySelector('[data-testid="status-dot"]')).not.toBeNull()

    await act(async () => {
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('hides the internal name fallback when an avatar URL is present', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <ProfileCard
          avatarUrl="/avatars/atlas.png"
          name="Atlas"
          title="Commander"
          handle="@atlas"
          status="Running"
          data-testid="commander-tile"
        />,
      )
    })

    const card = document.body.querySelector<HTMLButtonElement>('[data-testid="commander-tile"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).not.toContain('Atlas')
    expect(card?.textContent).toContain('@atlas')
    expect(document.body.querySelector('.hv-profile-card-details')).toBeNull()
    expect(document.body.querySelector('.hv-profile-card-name')).toBeNull()
    expect(document.body.querySelector('.hv-profile-card-title')).toBeNull()
    expect(document.body.querySelector('.hv-profile-card-portrait-fallback')).toBeNull()

    const image = document.body.querySelector<HTMLImageElement>('.hv-profile-card-portrait img')
    expect(image).not.toBeNull()

    await act(async () => {
      image?.dispatchEvent(new Event('error', { bubbles: false }))
      await Promise.resolve()
    })

    expect(document.body.querySelector('.hv-profile-card-portrait-fallback')).not.toBeNull()
    expect(document.body.querySelector('.hv-profile-card-details')).toBeNull()
    expect(document.body.querySelector('.hv-profile-card-name')).toBeNull()
    expect(document.body.querySelector('.hv-profile-card-title')).toBeNull()
  })

  it('renders stale Gaia svg avatar URLs through the regenerated png asset', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <ProfileCard
          avatarUrl="/assets/commanders/gaia-profile.svg"
          miniAvatarUrl="/assets/commanders/gaia-profile.svg"
          name="Gaia"
          title="Commander"
          handle="@gaia"
          status="Idle"
          data-testid="commander-tile"
        />,
      )
    })

    expect(document.body.querySelector<HTMLImageElement>('.hv-profile-card-portrait img')?.getAttribute('src')).toBe('/assets/commanders/gaia-profile.png')
    expect(document.body.querySelector<HTMLImageElement>('.hv-profile-card-mini-avatar img')?.getAttribute('src')).toBe('/assets/commanders/gaia-profile.png')
  })
})
