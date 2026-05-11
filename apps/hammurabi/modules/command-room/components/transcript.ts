import type { MsgItem } from '@modules/agents/messages/model'

export function mapSessionMessagesToTranscript(messages: MsgItem[]): MsgItem[] {
  return messages
}

function messageSignature(message: MsgItem): string {
  return JSON.stringify({
    kind: message.kind,
    text: message.text,
    toolId: message.toolId ?? null,
    toolName: message.toolName ?? null,
    toolStatus: message.toolStatus ?? null,
    toolInput: message.toolInput ?? null,
    toolOutput: message.toolOutput ?? null,
    images: message.images ?? null,
    planningAction: message.planningAction ?? null,
    planningPlan: message.planningPlan ?? null,
    planningMessage: message.planningMessage ?? null,
  })
}

export function mergeHistoricalAndLiveTranscript(
  historicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): MsgItem[] {
  if (historicalMessages.length === 0) {
    return liveMessages
  }
  if (liveMessages.length === 0) {
    return historicalMessages
  }

  const liveSignatureCounts = new Map<string, number>()
  for (const message of liveMessages) {
    const signature = messageSignature(message)
    liveSignatureCounts.set(signature, (liveSignatureCounts.get(signature) ?? 0) + 1)
  }

  const historicalWithoutReplay: MsgItem[] = []
  for (let index = historicalMessages.length - 1; index >= 0; index -= 1) {
    const message = historicalMessages[index]
    const signature = messageSignature(message)
    const replayCount = liveSignatureCounts.get(signature) ?? 0
    if (replayCount > 0) {
      liveSignatureCounts.set(signature, replayCount - 1)
      continue
    }
    historicalWithoutReplay.push(message)
  }

  return [
    ...historicalWithoutReplay.reverse(),
    ...liveMessages,
  ]
}
