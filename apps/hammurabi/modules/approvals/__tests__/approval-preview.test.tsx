// @vitest-environment jsdom

import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PendingApproval } from '@/hooks/use-approvals'
import ApprovalCard from '../ApprovalCard'
import ApprovalSheet from '../ApprovalSheet'

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildApproval(): PendingApproval {
  return {
    id: 'approval-1',
    decisionId: 'approval-1',
    actionLabel: 'Command Execution',
    actionId: 'command.execute',
    source: 'claude',
    commanderId: null,
    commanderName: 'Gaia',
    sessionName: 'commander-wizard-alpha',
    requestedAt: '2026-05-08T00:00:00.000Z',
    requestId: 'approval-1',
    reason: null,
    risk: null,
    summary: 'Create the requested commander.',
    previewText: 'curl -sS -X POST http://127.0.0.1:20001/api/commanders --data-binary ...',
    details: [],
    raw: {
      command: 'curl -sS -X POST http://127.0.0.1:20001/api/commanders --data-binary ...',
    },
    context: null,
  }
}

function hardcodedWhiteBackgroundClasses(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => (
    Array.from(element.classList).filter((className) => (
      className === 'bg-white' || className.startsWith('bg-white/')
    ))
  ))
}

async function render(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(element)
    await Promise.resolve()
  })
}

describe('approval preview presentation', () => {
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
    vi.clearAllMocks()
  })

  it('keeps full approval previews collapsed on cards', async () => {
    await render(
      <ApprovalCard
        approval={buildApproval()}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    )

    const details = document.body.querySelector('details')
    expect(document.body.textContent).toContain('Create the requested commander.')
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toContain('Full preview')
    expect(hardcodedWhiteBackgroundClasses()).toEqual([])
  })

  it('keeps sheet preview and raw payload behind explicit details controls', async () => {
    await render(
      <ApprovalSheet
        approval={buildApproval()}
        onClose={() => undefined}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    )

    const summaries = Array.from(document.body.querySelectorAll('summary'))
      .map((summary) => summary.textContent?.trim())
    const details = Array.from(document.body.querySelectorAll('details'))

    expect(summaries).toContain('Full Preview')
    expect(summaries).toContain('Raw Payload')
    expect(details.every((detail) => detail.open === false)).toBe(true)
    expect(hardcodedWhiteBackgroundClasses()).toEqual([])
  })
})
