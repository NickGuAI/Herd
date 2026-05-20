// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ConversationRecord,
  useConversationMessage,
} from '../hooks/use-conversations'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
let latestMutation: ReturnType<typeof useConversationMessage> | null = null
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

function HookHarness() {
  latestMutation = useConversationMessage()
  return null
}

async function renderHook(): Promise<void> {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient! },
        createElement(HookHarness),
      ),
    )
  })
}

beforeEach(() => {
  originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  queryClient?.clear()
  container?.remove()
  root = null
  container = null
  queryClient = null
  latestMutation = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('useConversationMessage', () => {
  it('posts text, images, and queue intent to the conversation message endpoint', async () => {
    await renderHook()

    const conversation: ConversationRecord = {
      id: 'conv-image',
      commanderId: 'commander-1',
      surface: 'ui',
      status: 'active',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:00:00.000Z',
      liveSession: null,
    }
    const image = { mediaType: 'image/png', data: 'base64-data' }
    const workspaceContext = {
      targetId: 'wt-1',
      conversationId: conversation.id,
      filePaths: ['apps/hammurabi/README.md'],
      fileAnnotations: [{
        path: 'apps/hammurabi/modules/conversation/hooks/use-conversations.ts',
        body: 'Use the backend workspace materializer.',
        quote: 'workspaceContext',
        range: { startLine: 1, endLine: 3 },
      }],
    }
    mocks.fetchJson.mockResolvedValue({
      accepted: true,
      createdSession: false,
      conversation,
    })

    if (!latestMutation) {
      throw new Error('expected mutation hook to be rendered')
    }

    await act(async () => {
      await latestMutation?.mutateAsync({
        conversationId: conversation.id,
        message: '',
        images: [image],
        workspaceContext,
        queue: true,
      })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/conversations/conv-image/message',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      }),
    )
    const [, request] = mocks.fetchJson.mock.calls[0] as [string, { body?: string }]
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      message: '',
      images: [image],
      queue: true,
      workspaceContext,
    })
  })
})
