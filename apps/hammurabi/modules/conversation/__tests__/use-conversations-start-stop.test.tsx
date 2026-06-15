// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commanderConversationsQueryKey,
  conversationDetailQueryKey,
  conversationMessagesQueryKey,
  type ConversationMessagesPage,
  type ConversationRecord,
  useConversationMessage,
  useStartConversation,
  useStopConversation,
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
let latestStartMutation: ReturnType<typeof useStartConversation> | null = null
let latestStopMutation: ReturnType<typeof useStopConversation> | null = null
let latestMessageMutation: ReturnType<typeof useConversationMessage> | null = null
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

function StartHookHarness() {
  latestStartMutation = useStartConversation()
  return null
}

function StopHookHarness() {
  latestStopMutation = useStopConversation()
  return null
}

function MessageHookHarness() {
  latestMessageMutation = useConversationMessage()
  return null
}

async function renderHook(mode: 'start' | 'stop' | 'message'): Promise<void> {
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
        createElement(
          mode === 'start'
            ? StartHookHarness
            : mode === 'stop'
              ? StopHookHarness
              : MessageHookHarness,
        ),
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
  latestStartMutation = null
  latestStopMutation = null
  latestMessageMutation = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('useStartConversation', () => {
  it('posts to the conversation start route, updates both caches, and returns the started conversation', async () => {
    await renderHook('start')

    const commanderId = 'commander/atlas'
    const otherConversation: ConversationRecord = {
      id: 'conv-other',
      commanderId,
      surface: 'ui',
      status: 'idle',
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
      createdAt: '2026-05-01T07:00:00.000Z',
      lastMessageAt: '2026-05-01T07:10:00.000Z',
      liveSession: null,
    }
    const startedConversation: ConversationRecord = {
      id: 'conv-started',
      commanderId,
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
      completedTasks: 1,
      totalCostUsd: 0.25,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:05:00.000Z',
      liveSession: null,
    }

    queryClient?.setQueryData(
      commanderConversationsQueryKey(commanderId),
      [otherConversation],
    )
    mocks.fetchJson.mockResolvedValue({ conversation: startedConversation })

    if (!latestStartMutation) {
      throw new Error('expected start mutation hook to be rendered')
    }

    let result: ConversationRecord | undefined
    await act(async () => {
      result = await latestStartMutation?.mutateAsync({
        conversationId: startedConversation.id,
        agentType: 'claude',
        effort: 'high',
        adaptiveThinking: 'enabled',
        cwd: '/workspace/project',
        host: 'yus-mac-mini',
      })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/conversations/conv-started/start',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'claude',
          effort: 'high',
          adaptiveThinking: 'enabled',
          cwd: '/workspace/project',
          host: 'yus-mac-mini',
        }),
      },
    )
    expect(queryClient?.getQueryData(commanderConversationsQueryKey(commanderId))).toEqual([
      startedConversation,
      otherConversation,
    ])
    expect(
      queryClient?.getQueryData(conversationDetailQueryKey(startedConversation.id)),
    ).toEqual(startedConversation)
    expect(result).toEqual(startedConversation)
  })
})

describe('useStopConversation', () => {
  it('posts to the conversation pause route, updates both caches, and returns the paused conversation', async () => {
    await renderHook('stop')

    const commanderId = 'commander/atlas'
    const otherConversation: ConversationRecord = {
      id: 'conv-other',
      commanderId,
      surface: 'ui',
      status: 'idle',
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
      createdAt: '2026-05-01T07:00:00.000Z',
      lastMessageAt: '2026-05-01T07:10:00.000Z',
      liveSession: null,
    }
    const pausedConversation: ConversationRecord = {
      id: 'conv-active',
      commanderId,
      surface: 'ui',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 2,
      totalCostUsd: 1.2,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:10:00.000Z',
      liveSession: null,
    }

    queryClient?.setQueryData(
      commanderConversationsQueryKey(commanderId),
      [{ ...pausedConversation, status: 'active' } satisfies ConversationRecord, otherConversation],
    )
    mocks.fetchJson.mockResolvedValue(pausedConversation)

    if (!latestStopMutation) {
      throw new Error('expected stop mutation hook to be rendered')
    }

    let result: ConversationRecord | undefined
    await act(async () => {
      result = await latestStopMutation?.mutateAsync({
        conversationId: pausedConversation.id,
      })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/conversations/conv-active/pause',
      {
        method: 'POST',
      },
    )
    expect(queryClient?.getQueryData(commanderConversationsQueryKey(commanderId))).toEqual([
      pausedConversation,
      otherConversation,
    ])
    expect(
      queryClient?.getQueryData(conversationDetailQueryKey(pausedConversation.id)),
    ).toEqual(pausedConversation)
    expect(result).toEqual(pausedConversation)
  })
})

describe('useConversationMessage', () => {
  it('writes the returned live message page into cache without waiting for list polling', async () => {
    await renderHook('message')

    const commanderId = 'commander/atlas'
    const conversation: ConversationRecord = {
      id: 'conv-active',
      commanderId,
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
      completedTasks: 2,
      totalCostUsd: 1.2,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:10:00.000Z',
      liveSession: null,
      websocketReady: true,
    }
    const previousPage: ConversationMessagesPage = {
      conversationId: conversation.id,
      sessionName: 'commander-atlas-conversation-conv-active',
      source: 'canonical',
      limit: 10,
      before: null,
      nextBefore: null,
      hasMore: false,
      totalMessages: 1,
      messages: [{ id: 'old-user', kind: 'user', text: 'old cached text' }],
    }
    const olderPage: ConversationMessagesPage = {
      ...previousPage,
      before: '1',
      totalMessages: 2,
      messages: [{ id: 'older-user', kind: 'user', text: 'older text' }],
    }
    const messagePage: ConversationMessagesPage = {
      ...previousPage,
      source: 'canonical',
      totalMessages: 2,
      messages: [
        { id: 'old-user', kind: 'user', text: 'old cached text' },
        { id: 'fresh-user', kind: 'user', text: 'fresh text' },
      ],
    }

    queryClient?.setQueryData(
      commanderConversationsQueryKey(commanderId),
      [{ ...conversation, lastMessageAt: '2026-05-01T08:05:00.000Z' }],
    )
    queryClient?.setQueryData(
      conversationMessagesQueryKey(conversation.id),
      {
        pages: [previousPage, olderPage],
        pageParams: [null, '1'],
      },
    )
    mocks.fetchJson.mockResolvedValue({
      accepted: true,
      createdSession: false,
      conversation,
      messagePage,
    })

    if (!latestMessageMutation) {
      throw new Error('expected message mutation hook to be rendered')
    }

    await act(async () => {
      await latestMessageMutation?.mutateAsync({
        conversationId: conversation.id,
        message: 'fresh text',
      })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/conversations/conv-active/message',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'fresh text',
        }),
      },
    )
    expect(
      queryClient?.getQueryData(conversationDetailQueryKey(conversation.id)),
    ).toEqual(conversation)
    expect(queryClient?.getQueryData(conversationMessagesQueryKey(conversation.id))).toEqual({
      pages: [messagePage, olderPage],
      pageParams: [null, '1'],
    })
    expect(queryClient?.getQueryData(commanderConversationsQueryKey(commanderId))).toEqual([
      conversation,
    ])
  })
})
