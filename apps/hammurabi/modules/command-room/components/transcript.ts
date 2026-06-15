import type { SessionQueueSnapshot } from '@/types'
import type { MsgItem } from '@modules/agents/messages/model'

export function mapSessionMessagesToTranscript(messages: MsgItem[]): MsgItem[] {
  return messages
}

export function appendQueuedMessagesToTranscript(
  messages: MsgItem[],
  _queueSnapshot?: SessionQueueSnapshot | null,
): MsgItem[] {
  return messages
}

function isPendingOptimisticUserMessage(message: MsgItem): boolean {
  return (
    message.kind === 'user'
    && Boolean(message.clientSendId?.trim())
    && !message.transcript
  )
}

function getPendingOptimisticMessages(
  canonicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): MsgItem[] {
  if (liveMessages.length === 0) {
    return []
  }

  const confirmedClientSendIds = new Set(
    canonicalMessages
      .filter((message) => message.kind === 'user')
      .map((message) => message.clientSendId?.trim())
      .filter((clientSendId): clientSendId is string => Boolean(clientSendId)),
  )
  const pendingMessages = liveMessages.filter((message) => {
    const clientSendId = message.clientSendId?.trim()
    return (
      isPendingOptimisticUserMessage(message)
      && Boolean(clientSendId)
      && !confirmedClientSendIds.has(clientSendId)
    )
  })
  return pendingMessages
}

export function hasPendingOptimisticMessages(
  canonicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): boolean {
  return getPendingOptimisticMessages(canonicalMessages, liveMessages).length > 0
}

export function appendPendingOptimisticMessagesToTranscript(
  canonicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): MsgItem[] {
  const pendingMessages = getPendingOptimisticMessages(canonicalMessages, liveMessages)
  if (pendingMessages.length === 0) {
    return canonicalMessages
  }

  return [
    ...canonicalMessages,
    ...pendingMessages,
  ]
}
