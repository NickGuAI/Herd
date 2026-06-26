import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { HerdEvent } from '@/types'
import { cn } from '@/lib/utils'
import type { MsgItem } from '../messages/model'
import { SessionMessageList } from './SessionMessageList'
import { useStreamEventProcessor } from './use-stream-event-processor'

export interface TranscriptHandle {
  resetAutoScroll: () => void
}

export interface TranscriptProps {
  events?: HerdEvent[]
  messages?: MsgItem[]
  sessionId: string
  agentAvatarUrl?: string
  agentAccentColor?: string
  onAnswer?: (toolId: string, answers: Record<string, string[]>) => void
  onOpenWorkspaceFile?: (path: string) => void
  dark?: boolean
  className?: string
}

function getMessageScrollSignature(message: MsgItem | undefined): string {
  if (!message) {
    return 'empty'
  }
  const transcript = message.transcript
  const durableKey = transcript?.seq
    ?? transcript?.itemId
    ?? transcript?.turnId
    ?? transcript?.providerEventId
    ?? transcript?.envelopeId
    ?? message.clientSendId
    ?? message.id
  const lastChild = message.children?.[message.children.length - 1]
  return [
    durableKey,
    message.kind,
    message.text.length,
    message.images?.length ?? 0,
    message.children?.length ?? 0,
    lastChild?.id ?? '',
    lastChild?.text.length ?? 0,
  ].join(':')
}

function getLatestMessagesScrollSignature(messages: readonly MsgItem[]): string {
  return `${messages.length}:${getMessageScrollSignature(messages[messages.length - 1])}`
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(function Transcript(
  {
    events,
    messages,
    sessionId,
    agentAvatarUrl,
    agentAccentColor,
    onAnswer,
    onOpenWorkspaceFile,
    dark = false,
    className,
  },
  ref,
) {
  const {
    messages: processedMessages,
    processEvent,
    resetMessages,
  } = useStreamEventProcessor({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesAreaRef = useRef<HTMLDivElement>(null)
  const scrollHostRef = useRef<HTMLElement | null>(null)
  const isColdLoadRef = useRef(true)
  const autoScrollRef = useRef(true)
  const latestMessagesScrollSignatureRef = useRef<string | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const directMessages = messages
  const useDirectMessages = directMessages !== undefined
  const renderedMessages = useDirectMessages ? directMessages : processedMessages

  function scrollToBottom(instant = false): void {
    const host = scrollHostRef.current
    if (!host) {
      return
    }

    if (instant) {
      host.scrollTop = host.scrollHeight
      return
    }

    if (typeof host.scrollTo !== 'function') {
      host.scrollTop = host.scrollHeight
      return
    }

    host.scrollTo({ top: host.scrollHeight, behavior: 'smooth' })
  }

  function scheduleScrollToBottom(instant = false, afterScroll?: () => void): void {
    if (scrollFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
    if (typeof requestAnimationFrame !== 'function') {
      scrollToBottom(instant)
      afterScroll?.()
      return
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      scrollToBottom(instant)
      afterScroll?.()
    })
  }

  useEffect(() => {
    if (useDirectMessages) {
      return
    }

    resetMessages()
    for (const event of events ?? []) {
      processEvent(event, true)
    }
  }, [events, processEvent, resetMessages, sessionId, useDirectMessages])

  useEffect(() => {
    const start = messagesAreaRef.current
    if (!start) {
      return
    }

    let host: HTMLElement | null = start
    while (host && host !== document.body) {
      const overflowY = getComputedStyle(host).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        break
      }
      host = host.parentElement
    }

    const resolvedHost = host && host !== document.body ? host : start
    scrollHostRef.current = resolvedHost

    const onScroll = () => {
      autoScrollRef.current =
        resolvedHost.scrollHeight - resolvedHost.scrollTop - resolvedHost.clientHeight <= 120
    }

    resolvedHost.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resolvedHost.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    autoScrollRef.current = true
    isColdLoadRef.current = true
    latestMessagesScrollSignatureRef.current = null
    scheduleScrollToBottom(true, () => {
      isColdLoadRef.current = false
    })
  }, [sessionId])

  useEffect(() => {
    const latestSignature = getLatestMessagesScrollSignature(renderedMessages)
    const previousSignature = latestMessagesScrollSignatureRef.current
    latestMessagesScrollSignatureRef.current = latestSignature
    if (isColdLoadRef.current) {
      return
    }

    if (latestSignature !== previousSignature && autoScrollRef.current) {
      scheduleScrollToBottom()
    }
  }, [renderedMessages])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    resetAutoScroll() {
      autoScrollRef.current = true
      scheduleScrollToBottom()
    },
  }), [])

  return (
    <div
      ref={messagesAreaRef}
      className={cn('messages-area', dark && 'hv-dark', className)}
    >
      <SessionMessageList
        messages={renderedMessages}
        onAnswer={onAnswer ?? (() => {})}
        emptyLabel="Session started"
        agentAvatarUrl={agentAvatarUrl}
        agentAccentColor={agentAccentColor}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
      />
      <div ref={messagesEndRef} />
    </div>
  )
})

export default Transcript
