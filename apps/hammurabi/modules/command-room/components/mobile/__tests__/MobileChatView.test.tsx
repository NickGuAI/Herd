// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MobileChatView } from '../MobileChatView'

vi.mock('@modules/agents/page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({
    sessionName,
    sessionLabel,
    chatLabel,
    wsStatus,
    isStreaming,
    theme,
    rootClassName,
    approvals,
    workers,
    headerAccessory,
    emptyState,
    onBack,
  }: {
    sessionName: string
    sessionLabel: string
    chatLabel?: string
    wsStatus?: string | null
    isStreaming?: boolean
    theme?: string
    rootClassName?: string
    approvals?: unknown[]
    workers?: unknown[]
    headerAccessory?: ReactNode
    emptyState?: unknown
    onBack?: () => void
  }) => createElement(
    'div',
    {
      'data-testid': 'mobile-session-shell',
      'data-session-name': sessionName,
      'data-session-label': sessionLabel,
      'data-chat-label': chatLabel ?? '',
      'data-ws-status': wsStatus ?? '',
      'data-is-streaming': String(Boolean(isStreaming)),
      'data-theme': theme,
      'data-root-class': rootClassName,
      'data-approval-count': String(approvals?.length ?? 0),
      'data-worker-count': String(workers?.length ?? 0),
      'data-has-empty-state': String(Boolean(emptyState)),
    },
    headerAccessory,
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'mock-mobile-chat-back',
        onClick: onBack,
      },
      'Back',
    ),
    'MobileSessionShell',
  ),
}))

describe('MobileChatView', () => {
  it('adapts Herd chat props into the shared mobile shell and forwards theme', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Test Commander',
          status: 'running',
          description: 'Primary commander',
          avatarUrl: null,
          ui: { accentColor: '#f59e0b' },
        },
        workers: [
          { id: 'worker-1', name: 'worker-1', state: 'running', commanderId: 'cmd-1' },
        ],
        transcript: [],
        approvals: [{
          id: 'approval-1',
          decisionId: 'approval-1',
          actionLabel: 'Approve tool use',
          actionId: 'tool_use',
          source: 'codex',
          commanderId: 'cmd-1',
          commanderName: 'Test Commander',
          sessionName: 'commander-cmd-1',
          requestedAt: '2026-04-21T15:00:00.000Z',
          requestId: 'approval-1',
          reason: 'Needs approval',
          risk: 'high',
          summary: 'Run a command',
          previewText: null,
          details: [],
          raw: {},
          context: null,
        }],
        sessionName: 'commander-cmd-1',
        composerEnabled: true,
        composerSendReady: true,
        canQueueDraft: true,
        isStreaming: true,
        agentType: 'claude',
        wsStatus: 'connected',
        costUsd: 0.42,
        durationSec: 90,
        theme: 'light',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
        queueError: null,
        isQueueMutating: false,
        onBack: vi.fn(),
        onOpenTeam: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onAnswer: vi.fn(),
        onApproveApproval: vi.fn(),
        onDenyApproval: vi.fn(),
        onClearQueue: vi.fn(),
        onMoveQueuedMessage: vi.fn(),
        onRemoveQueuedMessage: vi.fn(),
        onSend: vi.fn(() => true),
        onQueue: vi.fn(() => true),
      }),
    )

    expect(html).toContain('data-testid="mobile-session-shell"')
    expect(html).toContain('data-session-label="Test Commander"')
    expect(html).toContain('data-is-streaming="true"')
    expect(html).toContain('data-theme="light"')
    expect(html).toContain('data-root-class="mobile-session-shell session-view-overlay hv-light"')
    expect(html).toContain('data-approval-count="1"')
    expect(html).toContain('data-worker-count="1"')
    expect(html).toContain('data-has-empty-state="false"')
  })

  it('does not pass the removed commander-start empty state when no conversation is selected', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Test Commander',
          status: 'idle',
          description: 'Primary commander',
        },
        workers: [],
        transcript: [],
        approvals: [],
        sessionName: 'commander-cmd-1',
        composerEnabled: false,
        composerSendReady: false,
        canQueueDraft: false,
        theme: 'dark',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
        queueError: null,
        isQueueMutating: false,
        onBack: vi.fn(),
        onOpenTeam: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onAnswer: vi.fn(),
        onApproveApproval: vi.fn(),
        onDenyApproval: vi.fn(),
        onClearQueue: vi.fn(),
        onMoveQueuedMessage: vi.fn(),
        onRemoveQueuedMessage: vi.fn(),
      }),
    )

    expect(html).toContain('data-testid="mobile-session-shell"')
    expect(html).toContain('data-has-empty-state="false"')
  })

  it('does not use legacy commander liveSession names for conversation pages', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Test Commander',
          status: 'running',
          description: 'Primary commander',
        },
        workers: [],
        transcript: [],
        approvals: [],
        sessionName: '',
        composerEnabled: false,
        composerSendReady: false,
        canQueueDraft: false,
        conversations: [{
          id: 'conv-1',
          commanderId: 'cmd-1',
          surface: 'ui',
          status: 'active',
          currentTask: null,
          lastHeartbeat: null,
          heartbeatTickCount: 0,
          completedTasks: 0,
          totalCostUsd: 0,
          name: 'Chat 1',
          createdAt: '2026-05-01T00:00:00.000Z',
          lastMessageAt: '2026-05-01T00:00:00.000Z',
          liveSession: {
            name: 'commander-cmd-1',
          },
          sendTarget: {
            kind: 'conversation',
            conversationId: 'conv-1',
            commanderId: 'cmd-1',
            sessionName: 'conversation-conv-1',
            transportType: 'stream',
            agentType: 'claude',
            queue: { supported: true, reason: null },
            media: { supported: true, reason: null },
          },
        }],
        selectedConversationId: 'conv-1',
        theme: 'dark',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
        queueError: null,
        isQueueMutating: false,
        onBack: vi.fn(),
        onOpenTeam: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onAnswer: vi.fn(),
        onApproveApproval: vi.fn(),
        onDenyApproval: vi.fn(),
        onClearQueue: vi.fn(),
        onMoveQueuedMessage: vi.fn(),
        onRemoveQueuedMessage: vi.fn(),
      }),
    )

    expect(html).toContain('data-session-name="conversation-conv-1"')
    expect(html).not.toContain('data-session-name="commander-cmd-1"')
  })

  it('passes the active conversation label, connected status, and page dots into the shell header', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'einstein',
          status: 'running',
          description: 'Primary commander',
        },
        workers: [],
        transcript: [],
        approvals: [],
        sessionName: 'conversation-conv-1',
        composerEnabled: true,
        composerSendReady: true,
        canQueueDraft: false,
        conversations: [
          {
            id: 'conv-1',
            commanderId: 'cmd-1',
            surface: 'ui',
            status: 'active',
            currentTask: null,
            lastHeartbeat: null,
            heartbeat: {
              intervalMs: 300000,
              messageTemplate: '',
              lastSentAt: null,
            },
            agentType: 'claude',
            providerContext: null,
            liveSession: null,
            createdAt: '2026-05-01T08:00:00.000Z',
            updatedAt: '2026-05-01T08:05:00.000Z',
            lastMessageAt: '2026-05-01T08:05:00.000Z',
            name: 'granite-cliff',
          },
          {
            id: 'conv-2',
            commanderId: 'cmd-1',
            surface: 'ui',
            status: 'active',
            currentTask: null,
            lastHeartbeat: null,
            heartbeat: {
              intervalMs: 300000,
              messageTemplate: '',
              lastSentAt: null,
            },
            agentType: 'codex',
            providerContext: null,
            liveSession: null,
            createdAt: '2026-05-01T08:10:00.000Z',
            updatedAt: '2026-05-01T08:15:00.000Z',
            lastMessageAt: '2026-05-01T08:15:00.000Z',
            name: 'chalk-ridge',
          },
        ],
        selectedConversationId: 'conv-1',
        isStreaming: false,
        agentType: 'claude',
        wsStatus: 'connected',
        theme: 'light',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
        queueError: null,
        isQueueMutating: false,
        onBack: vi.fn(),
        onOpenTeam: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onSelectConversationId: vi.fn(),
        onAnswer: vi.fn(),
        onApproveApproval: vi.fn(),
        onDenyApproval: vi.fn(),
        onClearQueue: vi.fn(),
        onMoveQueuedMessage: vi.fn(),
        onRemoveQueuedMessage: vi.fn(),
      }),
    )

    expect(html).toContain('data-session-label="einstein"')
    expect(html).toContain('data-chat-label="granite-cliff"')
    expect(html).toContain('data-ws-status="connected"')
    expect(html).toContain('data-testid="mobile-chat-page-dots"')
    expect((html.match(/data-testid="mobile-chat-page-dot"/g) ?? [])).toHaveLength(2)
  })

  it('forwards the mobile shell back action', () => {
    const onBack = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement(MobileChatView, {
          commander: {
            id: 'cmd-1',
            name: 'Test Commander',
            status: 'running',
            description: 'Primary commander',
          },
          workers: [],
          transcript: [],
          approvals: [],
          sessionName: 'commander-cmd-1',
          composerEnabled: true,
          composerSendReady: true,
          canQueueDraft: true,
          theme: 'light',
          onSetTheme: vi.fn(),
          queueSnapshot: {
            currentMessage: null,
            items: [],
            totalCount: 0,
            maxSize: 8,
          },
          queueError: null,
          isQueueMutating: false,
          onBack,
          onOpenTeam: vi.fn(),
          onOpenWorkspace: vi.fn(),
          onAnswer: vi.fn(),
          onApproveApproval: vi.fn(),
          onDenyApproval: vi.fn(),
          onClearQueue: vi.fn(),
          onMoveQueuedMessage: vi.fn(),
          onRemoveQueuedMessage: vi.fn(),
        }),
      )
    })

    const backButton = document.body.querySelector('[data-testid="mock-mobile-chat-back"]')
    expect(backButton).not.toBeNull()
    act(() => {
      ;(backButton as HTMLButtonElement).click()
    })
    expect(onBack).toHaveBeenCalledTimes(1)

    flushSync(() => {
      root.unmount()
    })
    container.remove()
    document.body.innerHTML = ''
  })
})
