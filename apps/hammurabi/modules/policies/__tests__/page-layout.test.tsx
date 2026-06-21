// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useActionPolicies: vi.fn(),
  usePolicySettings: vi.fn(),
  usePolicyCommanders: vi.fn(),
  useUpdateActionPolicy: vi.fn(),
  useUpdatePolicySettings: vi.fn(),
  useSkills: vi.fn(),
}))

vi.mock('@/hooks/use-action-policies', () => ({
  useActionPolicies: mocks.useActionPolicies,
  usePolicySettings: mocks.usePolicySettings,
  usePolicyCommanders: mocks.usePolicyCommanders,
  useUpdateActionPolicy: mocks.useUpdateActionPolicy,
  useUpdatePolicySettings: mocks.useUpdatePolicySettings,
}))

vi.mock('@/hooks/use-skills', () => ({
  useSkills: mocks.useSkills,
}))

import PoliciesPage from '../page'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null
let updatePolicyMutate: ReturnType<typeof vi.fn>

function createQueryResult<T>(data: T) {
  return {
    data,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }
}

async function renderPoliciesPage(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<PoliciesPage />)
    await Promise.resolve()
  })
}

describe('PoliciesPage layout', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

    mocks.usePolicyCommanders.mockReturnValue(createQueryResult([
      {
        id: 'cmd-atlas',
        displayName: 'Atlas',
        host: 'mac-mini',
      },
    ]))
    mocks.useActionPolicies.mockReturnValue(createQueryResult([
      {
        actionId: 'send-email',
        id: 'send-email',
        name: 'Send Email',
        kind: 'action',
        policy: 'review',
        allowlist: ['*@gehirn.ai'],
        blocklist: ['*@blocked.example'],
        sourceScope: 'global',
        scope: 'global',
      },
    ]))
    mocks.usePolicySettings.mockReturnValue(createQueryResult({
      timeoutMinutes: 15,
      timeoutAction: 'block',
      standingApprovalExpiryDays: 30,
    }))
    mocks.useSkills.mockReturnValue(createQueryResult([
      {
        name: 'audit-pr',
        description: 'Review a pull request.',
        userInvocable: true,
        supportedProviders: ['codex', 'claude code'],
        source: 'direct-skills',
      },
    ]))
    updatePolicyMutate = vi.fn()
    mocks.useUpdateActionPolicy.mockReturnValue({
      mutate: updatePolicyMutate,
      error: null,
      isPending: false,
      variables: null,
    })
    mocks.useUpdatePolicySettings.mockReturnValue({
      mutate: vi.fn(),
      error: null,
      isPending: false,
      variables: null,
    })
  })

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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    vi.clearAllMocks()
  })

  it('renders the master-detail policies surface with skill provider badges', async () => {
    await renderPoliciesPage()

    const page = await vi.waitFor(() => {
      const element = document.body.querySelector('[data-testid="policies-page"]') as HTMLElement | null
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(page.tagName).toBe('SECTION')
    const pageClasses = page.className.split(/\s+/)
    expect(pageClasses).toContain('flex')
    expect(pageClasses).toContain('h-full')
    expect(pageClasses).toContain('min-h-0')
    expect(pageClasses).toContain('w-full')
    expect(pageClasses).toContain('min-w-0')

    const content = document.body.querySelector('[data-testid="policies-page-content"]') as HTMLElement | null
    expect(content).not.toBeNull()
    const contentClasses = content?.className.split(/\s+/) ?? []
    expect(contentClasses).toContain('flex')
    expect(contentClasses).toContain('flex-1')
    expect(contentClasses).toContain('min-h-0')
    expect(contentClasses).toContain('overflow-hidden')

    const listPane = document.body.querySelector('[data-testid="policy-list-pane"]') as HTMLElement | null
    expect(listPane).not.toBeNull()
    expect(listPane?.className).toContain('w-full')
    expect(listPane?.className).toContain('md:w-64')
    expect(listPane?.className).toContain('lg:w-72')
    expect(listPane?.className).toContain('shrink-0')

    const detailShell = document.body.querySelector('[data-testid="policy-detail-shell"]') as HTMLElement | null
    expect(detailShell).not.toBeNull()
    expect(detailShell?.className).toContain('flex-1')
    expect(detailShell?.className).toContain('min-w-0')
    expect(detailShell?.className).toContain('hidden md:flex')

    expect(document.body.textContent).toContain('/audit-pr')
    expect(document.body.textContent).toContain('Review a pull request.')
    expect(document.body.textContent).toContain('Supported Providers')
    expect(document.body.textContent).toContain('codex')
    expect(document.body.textContent).toContain('claude code')
    expect(document.body.textContent).toContain('Queue Defaults')
    expect(document.body.querySelector('[data-testid="policies-table-scroll"]')).toBeNull()
  })

  it('uses the mobile list-to-detail back navigation classes', async () => {
    await renderPoliciesPage()

    const listPane = document.body.querySelector('[data-testid="policy-list-pane"]') as HTMLElement | null
    const detailShell = document.body.querySelector('[data-testid="policy-detail-shell"]') as HTMLElement | null
    const row = document.body.querySelector('[data-testid="policy-row-skill:audit-pr"]') as HTMLButtonElement | null
    expect(listPane?.className).toContain('flex')
    expect(detailShell?.className).toContain('hidden md:flex')
    expect(row).not.toBeNull()

    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(listPane?.className).toContain('hidden md:flex')
    expect(detailShell?.className.split(/\s+/)).toContain('flex')

    const backButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Policies'),
    ) as HTMLButtonElement | undefined
    expect(backButton).toBeDefined()

    await act(async () => {
      backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(listPane?.className).toContain('flex')
    expect(detailShell?.className).toContain('hidden md:flex')
  })

  it('updates the selected row policy from the detail pane', async () => {
    await renderPoliciesPage()

    const select = document.getElementById('policy-detail-select-skill:audit-pr') as HTMLSelectElement | null
    expect(select).not.toBeNull()

    await act(async () => {
      if (select) {
        select.value = 'block'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      await Promise.resolve()
    })

    expect(updatePolicyMutate).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'global',
      actionId: 'skill:audit-pr',
      id: 'skill:audit-pr',
      name: '/audit-pr',
      kind: 'skill',
      policy: 'block',
    }))
  })
})
