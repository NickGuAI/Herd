// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commanderActiveConversationQueryKey,
  commanderConversationsQueryKey,
  type ConversationRecord,
  conversationDetailQueryKey,
  useActiveConversation,
  useConversations,
} from '../hooks/use-conversations'

const capturedQueries = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const queryDataByKey = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn((options: Record<string, unknown>) => {
      capturedQueries.push(options)
      const queryKey = JSON.stringify(options.queryKey)
      const initialData = typeof options.initialData === 'function'
        ? (options.initialData as () => unknown)()
        : undefined
      return {
        data: queryDataByKey.has(queryKey) ? queryDataByKey.get(queryKey) : initialData,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(async () => undefined),
      }
    }),
  }
})

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
let latestSelectedConversation: ConversationRecord | null = null

function HookHarness() {
  latestSelectedConversation = useConversations('commander-1', 'conversation-1').selectedConversation
  useActiveConversation('commander-1', true)
  return null
}

function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: 'conversation-1',
    commanderId: 'commander-1',
    name: 'quiet-quartz',
    status: 'idle',
    surface: 'ui',
    currentTask: null,
    createdAt: '2026-05-24T00:00:00.000Z',
    lastMessageAt: '2026-05-24T00:00:00.000Z',
    liveSession: null,
    runtimeState: 'idle',
    websocketReady: false,
    allowedActions: {
      send: false,
      queue: false,
      media: false,
      start: true,
      pause: false,
      resume: false,
      archive: true,
      delete: true,
      updateProvider: true,
    },
    ...overrides,
  } as ConversationRecord
}

async function renderHook(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(createElement(HookHarness))
  })
}

beforeEach(() => {
  originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  capturedQueries.length = 0
  queryDataByKey.clear()
  latestSelectedConversation = null
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('conversation query polling', () => {
  it('polls the commander conversation list without polling selected detail or active-chat lookup', async () => {
    await renderHook()

    const listQuery = capturedQueries.find((query) =>
      JSON.stringify(query.queryKey) === JSON.stringify(commanderConversationsQueryKey('commander-1')),
    )
    const detailQuery = capturedQueries.find((query) =>
      JSON.stringify(query.queryKey) === JSON.stringify(conversationDetailQueryKey('conversation-1')),
    )
    const activeQuery = capturedQueries.find((query) =>
      JSON.stringify(query.queryKey) === JSON.stringify(commanderActiveConversationQueryKey('commander-1')),
    )

    expect(listQuery).toMatchObject({ refetchInterval: 5000 })
    expect(detailQuery).toMatchObject({ staleTime: 30_000 })
    expect(detailQuery).not.toHaveProperty('refetchInterval')
    expect(activeQuery).toMatchObject({ staleTime: 30_000 })
    expect(activeQuery).not.toHaveProperty('refetchInterval')
  })

  it('lets the polled list promote a selected conversation after async start completes', async () => {
    const startingDetail = makeConversation({
      status: 'active',
      runtimeState: 'starting',
      websocketReady: false,
      allowedActions: {
        send: false,
        queue: false,
        media: false,
        start: false,
        pause: false,
        resume: false,
        archive: true,
        delete: true,
        updateProvider: true,
      },
    })
    const activeListEntry = makeConversation({
      status: 'active',
      runtimeState: 'active',
      websocketReady: true,
      liveSession: { name: 'session-1' } as ConversationRecord['liveSession'],
      allowedActions: {
        send: true,
        queue: true,
        media: true,
        start: false,
        pause: true,
        resume: false,
        archive: true,
        delete: true,
        updateProvider: true,
      },
    })
    queryDataByKey.set(JSON.stringify(conversationDetailQueryKey('conversation-1')), startingDetail)
    queryDataByKey.set(JSON.stringify(commanderConversationsQueryKey('commander-1')), [activeListEntry])

    await renderHook()

    expect(latestSelectedConversation?.runtimeState).toBe('active')
    expect(latestSelectedConversation?.websocketReady).toBe(true)
    expect(latestSelectedConversation?.allowedActions?.send).toBe(true)
  })

  it('keeps active selected detail over a less-ready polled list row', async () => {
    const activeDetail = makeConversation({
      status: 'active',
      runtimeState: 'active',
      websocketReady: true,
      allowedActions: {
        send: true,
        queue: true,
        media: true,
        start: false,
        pause: true,
        resume: false,
        archive: true,
        delete: true,
        updateProvider: true,
      },
    })
    const idleListEntry = makeConversation({
      status: 'idle',
      runtimeState: 'idle',
      websocketReady: false,
      allowedActions: {
        send: false,
        queue: false,
        media: false,
        start: true,
        pause: false,
        resume: false,
        archive: true,
        delete: true,
        updateProvider: true,
      },
    })
    queryDataByKey.set(JSON.stringify(conversationDetailQueryKey('conversation-1')), activeDetail)
    queryDataByKey.set(JSON.stringify(commanderConversationsQueryKey('commander-1')), [idleListEntry])

    await renderHook()

    expect(latestSelectedConversation?.runtimeState).toBe('active')
    expect(latestSelectedConversation?.allowedActions?.send).toBe(true)
  })
})
