// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingApproval } from '@/hooks/use-approvals'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
  getAccessToken: vi.fn(),
  pendingApprovals: [] as PendingApproval[],
  approvalDecision: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
  getAccessToken: mocks.getAccessToken,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: () => ({
    data: mocks.pendingApprovals,
    error: null,
    isError: false,
    refetch: vi.fn(async () => ({ data: mocks.pendingApprovals })),
  }),
  useApprovalDecision: () => ({
    mutateAsync: mocks.approvalDecision,
    isPending: false,
    variables: null,
    error: null,
  }),
}))

import { WizardChatPanel } from '../WizardChatPanel'

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  binaryType: BinaryType = 'blob'
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    window.setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, wasClean: true } as CloseEvent)
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalWebSocket: typeof WebSocket | undefined

function buildApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'approval-1',
    decisionId: 'approval-1',
    actionLabel: 'Create commander',
    actionId: 'claude.tool',
    source: 'claude',
    commanderId: null,
    commanderName: null,
    sessionName: 'commander-wizard-alpha',
    requestedAt: '2026-05-08T00:00:00.000Z',
    requestId: 'approval-1',
    reason: null,
    risk: null,
    summary: 'Create a commander from the wizard proposal.',
    previewText: 'curl -sS -X POST http://127.0.0.1:20001/api/commanders ...',
    details: [],
    raw: { command: 'curl -sS -X POST http://127.0.0.1:20001/api/commanders ...' },
    context: { sessionName: 'commander-wizard-alpha' },
    ...overrides,
  }
}

async function flushReact() {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function renderPanel(props: ComponentProps<typeof WizardChatPanel> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<WizardChatPanel {...props} />)
    await flushReact()
  })

  await vi.waitFor(() => {
    expect(document.body.textContent).toContain('commander-wizard-alpha')
  })
}

function hardcodedWhiteBackgroundClasses(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => (
    Array.from(element.classList).filter((className) => (
      className === 'bg-white' || className.startsWith('bg-white/')
    ))
  ))
}

describe('WizardChatPanel', () => {
  beforeEach(() => {
    originalWebSocket = window.WebSocket
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    FakeWebSocket.instances = []
    mocks.fetchJson.mockReset()
    mocks.fetchJson.mockResolvedValue({ sessionName: 'commander-wizard-alpha', created: true })
    mocks.fetchVoid.mockReset()
    mocks.fetchVoid.mockResolvedValue(undefined)
    mocks.getAccessToken.mockReset()
    mocks.getAccessToken.mockResolvedValue(null)
    mocks.pendingApprovals = []
    mocks.approvalDecision.mockReset()
    mocks.approvalDecision.mockResolvedValue({ ok: true })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
        await flushReact()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    window.WebSocket = originalWebSocket as typeof WebSocket
    vi.clearAllMocks()
  })

  it('renders assistant markdown as one chat message', async () => {
    await renderPanel()
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    await act(async () => {
      socket?.emit(JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Plan:\n\n- choose a host\n- confirm approval\n\n```bash\necho ready\n```',
          }],
        },
      }))
      await flushReact()
    })

    expect(document.body.querySelectorAll('li')).toHaveLength(2)
    expect(document.body.querySelector('pre')?.textContent).toContain('echo ready')
    expect(hardcodedWhiteBackgroundClasses()).toEqual([])
  })

  it('does not render raw tool result echoes under the chat transcript', async () => {
    await renderPanel()
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    await act(async () => {
      socket?.emit(JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Preview:\n\n- Gaia\n- onboarding',
          }],
        },
      }))
      socket?.emit(JSON.stringify({
        type: 'user',
        tool_use_result: {
          stdout: 'Preview:\\n\\n- Gaia\\n- onboarding',
          stderr: 'duplicate raw stderr',
        },
      }))
      await flushReact()
    })

    expect(document.body.querySelectorAll('li')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('duplicate raw stderr')
    expect(document.body.textContent).not.toContain('Preview:\\n\\n- Gaia\\n- onboarding')
  })

  it('detects wizard completion from replay projection messages', async () => {
    const onCreated = vi.fn()
    await renderPanel({ onCreated })
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    await act(async () => {
      socket?.emit(JSON.stringify({
        type: 'replay',
        projection: {
          messages: [{
            id: 'msg-success',
            kind: 'agent',
            text: 'WIZARD_CREATE_SUCCESS commander-123 local',
          }],
        },
      }))
      await flushReact()
    })

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })
    expect(mocks.fetchVoid).toHaveBeenCalledWith(
      '/api/commanders/wizard/commander-wizard-alpha',
      { method: 'DELETE' },
    )
  })

  it('detects wizard completion from live v2 transcript envelopes', async () => {
    const onCreated = vi.fn()
    await renderPanel({ onCreated })
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    await act(async () => {
      socket?.emit(JSON.stringify({
        schemaVersion: 2,
        id: 'env-success',
        time: '2026-06-18T00:00:00.000Z',
        source: { provider: 'claude', backend: 'sdk' },
        ev: {
          type: 'message.delta',
          channel: 'final',
          text: 'WIZARD_CREATE_SUCCESS commander-456 local',
        },
      }))
      await flushReact()
    })

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })
  })

  it('does not treat v2 user echoes as assistant output or wizard completion', async () => {
    const onCreated = vi.fn()
    await renderPanel({ onCreated })
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    await act(async () => {
      socket?.emit(JSON.stringify({
        schemaVersion: 2,
        id: 'env-user-echo',
        time: '2026-06-18T00:00:00.000Z',
        source: {
          provider: 'claude',
          backend: 'sdk',
          rawEventType: 'hammurabi/user',
        },
        clientSendId: 'send-user-echo-1',
        ev: {
          type: 'message.delta',
          channel: 'final',
          text: 'WIZARD_CREATE_SUCCESS commander-from-user-echo local',
        },
      }))
      await flushReact()
    })

    expect(onCreated).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('commander-from-user-echo')
  })

  it('detects wizard completion when live v2 transcript deltas split the success marker', async () => {
    const onCreated = vi.fn()
    await renderPanel({ onCreated })
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    const emitDelta = (text: string) => {
      socket?.emit(JSON.stringify({
        schemaVersion: 2,
        id: `env-success-${text}`,
        time: '2026-06-18T00:00:00.000Z',
        source: { provider: 'claude', backend: 'sdk' },
        ev: {
          type: 'message.delta',
          channel: 'final',
          text,
        },
      }))
    }

    await act(async () => {
      emitDelta('WIZARD_CREATE_SUCCESS ')
      emitDelta('commander-789')
      emitDelta(' ')
      emitDelta('local')
      await flushReact()
    })

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })
  })

  it('shows matching pending approvals inline and resolves them from the panel', async () => {
    const approval = buildApproval()
    mocks.pendingApprovals = [approval, buildApproval({
      id: 'other-approval',
      decisionId: 'other-approval',
      sessionName: 'other-session',
    })]

    await renderPanel()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="wizard-inline-approvals"]')).not.toBeNull()
    })
    expect(document.body.textContent).toContain('Create commander')
    expect(document.body.textContent).not.toContain('other-session')

    const approveButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Approve'))
    expect(approveButton).toBeDefined()

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushReact()
    })

    expect(mocks.approvalDecision).toHaveBeenCalledWith({ approval, decision: 'approve' })
  })
})
