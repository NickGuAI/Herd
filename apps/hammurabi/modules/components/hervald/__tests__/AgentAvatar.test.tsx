// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentAvatar } from '../primitives'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  flushSync(() => {
    root?.render(element)
  })
}

describe('AgentAvatar — live commander shape', () => {
  afterEach(async () => {
    if (root) {
      flushSync(() => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
  })

  it('renders the uploaded avatar image when avatarUrl is provided', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'atlas-id',
          displayName: 'Test Commander',
          host: 'atlas',
          avatarUrl: '/commander-assets/atlas-id/avatar',
          ui: null,
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]')
    expect(avatar).not.toBeNull()

    const img = avatar?.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('/commander-assets/atlas-id/avatar')
    expect(img?.getAttribute('alt')).toBe('Test Commander')
  })

  it('renders a neutral empty tile when avatarUrl is absent using Sumi-e tokens', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'zephyr-id',
          displayName: 'Demo User',
          host: 'zephyr',
          avatarUrl: null,
          ui: null,
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.querySelector('img')).toBeNull()
    expect(avatar?.textContent).toBe('')
    expect(avatar?.getAttribute('style')).not.toContain('--hv-avatar-accent')
  })

  it('does not synthesize per-commander accent colors when ui is missing', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'some-stable-id',
          displayName: 'Stable',
          host: 'stable',
          avatarUrl: null,
          ui: null,
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.textContent).toBe('')
    expect(avatar?.getAttribute('style')).not.toContain('--hv-avatar-accent')
  })

  it('stays empty when displayName is empty and host is present', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'host-only',
          displayName: '',
          host: 'operator',
          avatarUrl: null,
          ui: null,
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]')
    expect(avatar?.textContent).toBe('')
  })

  it('raises border weight when active is true', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'active-cmd',
          displayName: 'Active',
          host: 'active',
          avatarUrl: null,
          ui: null,
        }}
        size={32}
        active
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.textContent).toBe('')
    expect(avatar?.getAttribute('style')).not.toContain('--hv-avatar-accent')
  })

  it('defaults to a circle and supports the opt-in rounded square shape', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'square-cmd',
          displayName: 'Square',
          host: 'square',
          avatarUrl: null,
          ui: null,
        }}
        size={30}
        shape="square"
      />,
    )

    let avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.style.borderRadius).toBe('var(--hv-radius-md)')

    flushSync(() => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''

    await render(
      <AgentAvatar
        commander={{
          id: 'circle-cmd',
          displayName: 'Circle',
          host: 'circle',
          avatarUrl: null,
          ui: null,
        }}
        size={30}
      />,
    )

    avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.style.borderRadius).toBe('50%')
  })
})
