import type { MsgItem } from './model.js'

const ID_PART_SEPARATOR = '\u001f'

function normalizePart(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return String(value).trim()
}

function hasValue(value: unknown): boolean {
  return normalizePart(value).length > 0
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function identityFromParts(kind: MsgItem['kind'], parts: unknown[]): string | null {
  const normalized = parts.map(normalizePart)
  if (!normalized.some((part) => part.length > 0)) {
    return null
  }
  return `hist-${kind}-${stableHash(normalized.join(ID_PART_SEPARATOR))}`
}

function durableTranscriptParts(message: MsgItem): unknown[] {
  const transcript = message.transcript
  if (!transcript) {
    return []
  }
  if (hasValue(message.toolId) || hasValue(transcript.itemId) || hasValue(transcript.turnId)) {
    return [transcript.turnId, transcript.itemId, message.toolId]
  }
  return [transcript.providerEventId, transcript.envelopeId, transcript.seq]
}

export function getStableMessageIdentity(message: MsgItem): string | null {
  if (message.kind === 'user' && hasValue(message.clientSendId)) {
    return identityFromParts(message.kind, ['client-send', message.clientSendId])
  }

  const transcript = message.transcript
  if (!transcript) {
    return null
  }

  const source = transcript.source
  const sourceScope = [
    source?.provider,
    source?.backend,
    source?.sessionId,
    transcript.parentId,
    transcript.subagentId,
  ]

  if (message.kind === 'tool' && message.toolName === 'Agent' && transcript.task) {
    // The Agent tool-use id is the container identity shared by the Agent card
    // and later task lifecycle events. The provider task id is a fallback for
    // task-only events that have no tool association.
    const taskId = transcript.task.toolUseId ?? transcript.subagentId ?? transcript.task.taskId
    if (hasValue(taskId)) {
      return identityFromParts(message.kind, [
        source?.provider,
        source?.backend,
        'task',
        taskId,
      ])
    }
  }

  if (message.kind === 'tool' || message.kind === 'ask') {
    return identityFromParts(message.kind, [
      ...sourceScope,
      message.toolName,
      ...durableTranscriptParts(message),
    ])
  }

  if (message.kind === 'agent' || message.kind === 'thinking' || message.kind === 'planning') {
    return identityFromParts(message.kind, [
      ...sourceScope,
      ...durableTranscriptParts(message),
    ])
  }

  if (message.kind === 'user') {
    return identityFromParts(message.kind, [
      ...sourceScope,
      transcript.providerEventId,
      ...durableTranscriptParts(message),
    ])
  }

  if (message.kind === 'provider') {
    return identityFromParts(message.kind, [
      ...sourceScope,
      transcript.turnId,
      transcript.itemId,
      transcript.providerEventType,
      transcript.providerEventId,
      transcript.envelopeId,
      message.text,
    ])
  }

  if (message.kind === 'error') {
    return identityFromParts(message.kind, [
      ...sourceScope,
      transcript.turnId,
      transcript.itemId,
      transcript.providerEventType,
      transcript.providerEventId,
      transcript.envelopeId,
      message.providerError?.classification,
      message.providerError?.code,
      message.text,
    ])
  }

  if (message.kind === 'system') {
    return identityFromParts(message.kind, [
      ...sourceScope,
      transcript.turnId,
      transcript.itemId,
      transcript.providerEventType,
      transcript.providerEventId,
      transcript.envelopeId,
      message.text,
    ])
  }

  return identityFromParts(message.kind, [
    ...sourceScope,
    transcript.turnId,
    transcript.itemId,
    transcript.envelopeId,
    transcript.seq,
  ])
}

function uniqueStableId(baseId: string, seen: Map<string, number>): string {
  const count = seen.get(baseId) ?? 0
  seen.set(baseId, count + 1)
  return count === 0 ? baseId : `${baseId}-${count + 1}`
}

export function stabilizeMessageIds(messages: readonly MsgItem[]): MsgItem[] {
  const seen = new Map<string, number>()
  const visit = (items: readonly MsgItem[]): MsgItem[] => items.map((message) => {
    const stableId = getStableMessageIdentity(message) ?? message.id
    const nextId = uniqueStableId(stableId, seen)
    const children = message.children && message.children.length > 0
      ? stabilizeMessageIds(message.children)
      : message.children
    return {
      ...message,
      id: nextId,
      ...(children ? { children } : {}),
    }
  })
  return visit(messages)
}
