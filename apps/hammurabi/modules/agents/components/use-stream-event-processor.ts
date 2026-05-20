import { useCallback, useRef, useState } from 'react'
import type { StreamEvent } from '@/types'
import { capMessages, type MsgItem } from '../messages/model'
import {
  createStreamProcessorState,
  markAskAnsweredMessages,
  processStreamEvent,
  resetStreamProcessorState,
  type StreamEventProcessorContext,
} from '../messages/stream-event-machine'

export function useStreamEventProcessor(options?: {
  onWorkspaceMutation?: () => void
}) {
  const onWorkspaceMutation = options?.onWorkspaceMutation
  const idCounterRef = useRef(0)
  const processorStateRef = useRef(createStreamProcessorState())

  const [messages, setMessages] = useState<MsgItem[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

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

    const nextCounter = Math.max(
      idCounterRef.current,
      ...[...nextMessages, ...shadowMessages].flatMap((message) => [message, ...(message.children ?? [])])
        .map((message) => /^msg-(\d+)$/.exec(message.id)?.[1])
        .filter((value): value is string => Boolean(value))
        .map((value) => Number.parseInt(value, 10))
        .filter(Number.isFinite),
    )
    idCounterRef.current = Number.isFinite(nextCounter) ? nextCounter : idCounterRef.current
    setMessages(nextMessages)
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
