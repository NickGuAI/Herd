import { useCallback, useRef, useState } from 'react'
import type { StreamEvent } from '@/types'
import { capMessages, type MsgItem } from '../messages/model'
import { getStableMessageIdentity } from '../messages/stable-message-id'
import {
  createStreamProcessorState,
  hydrateStreamProcessorStateFromMessages,
  markAskAnsweredMessages,
  processStreamEvent,
  resetStreamProcessorState,
  type StreamEventProcessorContext,
} from '../messages/stream-event-machine'

function visitMessages(messages: readonly MsgItem[], visit: (message: MsgItem) => void): void {
  for (const message of messages) {
    visit(message)
    if (message.children && message.children.length > 0) {
      visitMessages(message.children, visit)
    }
  }
}

function remapReplayStateMessageIds(
  state: ReturnType<typeof createStreamProcessorState>,
  replayMessages: readonly MsgItem[],
  projectedMessages: readonly MsgItem[],
): void {
  const projectedIdByIdentity = new Map<string, string>()
  visitMessages(projectedMessages, (message) => {
    const identity = getStableMessageIdentity(message)
    if (identity) {
      projectedIdByIdentity.set(identity, message.id)
    }
  })

  if (projectedIdByIdentity.size === 0) {
    return
  }

  const replayToProjectedId = new Map<string, string>()
  visitMessages(replayMessages, (message) => {
    const identity = getStableMessageIdentity(message)
    const projectedId = identity ? projectedIdByIdentity.get(identity) : undefined
    if (projectedId) {
      replayToProjectedId.set(message.id, projectedId)
    }
  })

  if (replayToProjectedId.size === 0) {
    return
  }

  for (const active of Object.values(state.activeEnvelopeMessages)) {
    active.msgId = replayToProjectedId.get(active.msgId) ?? active.msgId
  }
  state.activeAgentMessageIds = state.activeAgentMessageIds.map((id) => replayToProjectedId.get(id) ?? id)
  for (const [key, id] of Object.entries(state.activeEnvelopeSubagents)) {
    state.activeEnvelopeSubagents[key] = replayToProjectedId.get(id) ?? id
  }
}

function getMessageMergeKey(message: MsgItem): string | null {
  return getStableMessageIdentity(message) ?? (
    message.clientSendId ? `client-send:${message.clientSendId}` : null
  )
}

function shouldPreferExistingMessage(existing: MsgItem, incoming: MsgItem): boolean {
  if (existing.kind !== incoming.kind) {
    return false
  }
  if (existing.text.length > incoming.text.length) {
    return true
  }
  if ((existing.images?.length ?? 0) > (incoming.images?.length ?? 0)) {
    return true
  }
  if ((existing.children?.length ?? 0) > (incoming.children?.length ?? 0)) {
    return true
  }
  return false
}

function preserveTerminalReplayStatus(existing: MsgItem, incoming: MsgItem): MsgItem {
  if (existing.kind !== 'tool' || incoming.kind !== 'tool') {
    return existing
  }
  const incomingTerminal = incoming.toolStatus === 'success' || incoming.toolStatus === 'error'
  const existingTerminal = existing.toolStatus === 'success' || existing.toolStatus === 'error'
  const toolStatus = incomingTerminal
    ? incoming.toolStatus
    : existingTerminal
      ? existing.toolStatus
      : existing.toolStatus ?? incoming.toolStatus
  return {
    ...existing,
    ...(toolStatus ? { toolStatus } : {}),
    ...(incomingTerminal && incoming.transcript
      ? {
          transcript: {
            ...existing.transcript,
            ...incoming.transcript,
            task: incoming.transcript.task ?? existing.transcript?.task,
          },
        }
      : {}),
  }
}

function hasDurableMessageAnchor(message: MsgItem): boolean {
  if (message.clientSendId) {
    return true
  }
  const transcript = message.transcript
  return Boolean(
    transcript?.source?.sessionId
    || transcript?.turnId
    || transcript?.itemId
    || transcript?.providerEventId
    || transcript?.envelopeId
  )
}

function mergeReplayMessagesWithCurrent(currentMessages: MsgItem[], nextMessages: MsgItem[]): MsgItem[] {
  if (currentMessages.length === 0) {
    return nextMessages
  }
  if (nextMessages.length === 0) {
    return currentMessages
  }

  const merged = [...nextMessages]
  const indexByKey = new Map<string, number>()
  for (const [index, message] of merged.entries()) {
    const key = getMessageMergeKey(message)
    if (key) {
      indexByKey.set(key, index)
    }
  }

  for (const currentMessage of currentMessages) {
    const key = getMessageMergeKey(currentMessage)
    if (!key) {
      continue
    }

    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      if (hasDurableMessageAnchor(currentMessage)) {
        indexByKey.set(key, merged.length)
        merged.push(currentMessage)
      }
      continue
    }

    if (shouldPreferExistingMessage(currentMessage, merged[existingIndex])) {
      merged[existingIndex] = preserveTerminalReplayStatus(currentMessage, merged[existingIndex])
    }
  }

  return merged
}

export function useStreamEventProcessor(options?: {
  onWorkspaceMutation?: () => void
}) {
  const onWorkspaceMutation = options?.onWorkspaceMutation
  const idCounterRef = useRef(0)
  const processorStateRef = useRef(createStreamProcessorState())

  const [messages, setMessages] = useState<MsgItem[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesRef = useRef<MsgItem[]>([])
  messagesRef.current = messages

  const nextId = useCallback(() => `msg-${++idCounterRef.current}`, [])

  const resetMessages = useCallback(() => {
    idCounterRef.current = 0
    resetStreamProcessorState(processorStateRef.current)
    setMessages([])
    setIsStreaming(false)
  }, [])

  const hydrateReplayMessages = useCallback((nextMessages: MsgItem[], replayEvents: StreamEvent[]) => {
    idCounterRef.current = 0
    resetStreamProcessorState(processorStateRef.current)

    let shadowMessages: MsgItem[] = []
    if (replayEvents.length > 0) {
      const shadowContext: StreamEventProcessorContext = {
        state: processorStateRef.current,
        nextId,
        setMessages: (updater) => {
          shadowMessages = updater(shadowMessages)
        },
        setIsStreaming,
        capMessages: (items) => items,
        onWorkspaceMutation,
      }

      for (const replayEvent of replayEvents) {
        processStreamEvent(shadowContext, replayEvent, true)
      }
      remapReplayStateMessageIds(processorStateRef.current, shadowMessages, nextMessages)
    } else {
      hydrateStreamProcessorStateFromMessages(processorStateRef.current, nextMessages)
    }

    const mergedMessages = mergeReplayMessagesWithCurrent(messagesRef.current, nextMessages)
    hydrateStreamProcessorStateFromMessages(processorStateRef.current, mergedMessages)

    const nextCounter = Math.max(
      idCounterRef.current,
      ...[...mergedMessages, ...shadowMessages].flatMap((message) => [message, ...(message.children ?? [])])
        .map((message) => /^msg-(\d+)$/.exec(message.id)?.[1])
        .filter((value): value is string => Boolean(value))
        .map((value) => Number.parseInt(value, 10))
        .filter(Number.isFinite),
    )
    idCounterRef.current = Number.isFinite(nextCounter) ? nextCounter : idCounterRef.current
    setMessages(mergedMessages)
  }, [nextId, onWorkspaceMutation])

  const markAskAnswered = useCallback((toolId: string) => {
    setMessages((prev) => markAskAnsweredMessages(prev, toolId))
  }, [])

  const processEventCallback = useCallback(
    (event: StreamEvent, isReplay = false) => {
      const context: StreamEventProcessorContext = {
        state: processorStateRef.current,
        nextId,
        setMessages,
        setIsStreaming,
        onWorkspaceMutation,
      }

      processStreamEvent(context, event, isReplay)
    },
    [nextId, onWorkspaceMutation],
  )

  const pushUserMessage = useCallback(
    (text: string) => {
      setMessages((prev) => capMessages([
        ...prev,
        { id: nextId(), kind: 'user', text },
      ]))
    },
    [nextId],
  )

  return {
    messages,
    setMessages,
    processEvent: processEventCallback,
    hydrateReplayMessages,
    resetMessages,
    isStreaming,
    markAskAnswered,
    pushUserMessage,
  }
}
