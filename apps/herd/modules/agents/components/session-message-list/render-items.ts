import {
  SUBAGENT_WORKING_LABEL,
  type MsgItem,
} from '../../messages/model'

export type RenderItem =
  | { type: 'single'; msg: MsgItem }
  | { type: 'activity-group'; id: string; messages: MsgItem[] }

export interface ProjectedSubagentActivity {
  id: string
  message: MsgItem
  toolCallCount: number
}

export interface ProjectedAgentActivity {
  subagents: ProjectedSubagentActivity[]
  unowned: MsgItem[]
}

interface MutableSubagentActivity {
  id: string
  message: MsgItem
  children: MsgItem[]
  childIds: Set<string>
}

function readId(value: string | undefined): string | undefined {
  const id = value?.trim()
  return id || undefined
}

function getAgentOwnerId(message: MsgItem): string | undefined {
  if (message.kind !== 'tool' || message.toolName !== 'Agent') {
    return undefined
  }
  return readId(message.transcript?.subagentId)
    ?? readId(message.toolId)
    ?? readId(message.transcript?.task?.toolUseId)
    ?? readId(message.transcript?.task?.taskId)
    ?? readId(message.id)
}

function getOwningSubagentId(message: MsgItem): string | undefined {
  return readId(message.transcript?.subagentId)
    ?? readId(message.transcript?.task?.parentToolUseId)
    ?? readId(message.transcript?.task?.toolUseId)
    ?? readId(message.transcript?.task?.taskId)
}

function normalizeProjectedStatus(value: string | undefined): MsgItem['toolStatus'] {
  const status = value?.trim().toLowerCase()
  if (status && ['ok', 'completed', 'complete', 'success', 'succeeded'].includes(status)) {
    return 'success'
  }
  if (
    status
    && ['error', 'failed', 'failure', 'cancelled', 'canceled', 'rejected', 'stopped', 'interrupted', 'aborted']
      .includes(status)
  ) {
    return 'error'
  }
  return 'running'
}

function createProjectedOwner(id: string, source: MsgItem): MsgItem {
  const task = source.transcript?.task
  return {
    id: `projected-subagent-${id}`,
    kind: 'tool',
    text: '',
    toolId: id,
    toolName: 'Agent',
    toolStatus: source.toolStatus ?? normalizeProjectedStatus(task?.status),
    subagentDescription: task?.description ?? task?.summary ?? SUBAGENT_WORKING_LABEL,
    isTaskPlaceholder: true,
    transcript: {
      ...source.transcript,
      subagentId: id,
    },
  }
}

function mergeOwnerMessage(current: MsgItem, incoming: MsgItem): MsgItem {
  return {
    ...current,
    ...incoming,
    id: current.id,
    subagentDescription: incoming.subagentDescription ?? current.subagentDescription,
    toolInput: incoming.toolInput ?? current.toolInput,
    toolOutput: incoming.toolOutput ?? current.toolOutput,
    transcript: {
      ...current.transcript,
      ...incoming.transcript,
      task: incoming.transcript?.task ?? current.transcript?.task,
    },
    children: undefined,
  }
}

function countNestedToolCalls(messages: readonly MsgItem[]): number {
  let count = 0
  for (const message of messages) {
    if (message.kind === 'tool' && message.toolName !== 'Agent') {
      count += 1
    }
    if (message.children) {
      count += countNestedToolCalls(message.children)
    }
  }
  return count
}

/**
 * Builds the visible owner -> activity relationship from durable transcript ids.
 * Descriptions and "last running" state are deliberately not correlation keys.
 */
export function projectAgentActivity(messages: readonly MsgItem[]): ProjectedAgentActivity {
  const owners = new Map<string, MutableSubagentActivity>()
  const ownerOrder: string[] = []
  const unowned: MsgItem[] = []

  function ensureOwner(id: string, source: MsgItem): MutableSubagentActivity {
    const existing = owners.get(id)
    if (existing) {
      return existing
    }
    const owner = {
      id,
      message: createProjectedOwner(id, source),
      children: [],
      childIds: new Set<string>(),
    }
    owners.set(id, owner)
    ownerOrder.push(id)
    return owner
  }

  function appendChild(owner: MutableSubagentActivity, child: MsgItem) {
    if (owner.childIds.has(child.id)) {
      return
    }
    owner.childIds.add(child.id)
    owner.children.push(child)
  }

  for (const message of messages) {
    const ownerId = getAgentOwnerId(message)
    if (!ownerId) {
      continue
    }
    const owner = ensureOwner(ownerId, message)
    owner.message = mergeOwnerMessage(owner.message, message)
  }

  for (const message of messages) {
    const ownerId = getAgentOwnerId(message)
    if (ownerId) {
      const owner = ensureOwner(ownerId, message)
      for (const child of message.children ?? []) {
        const explicitChildOwnerId = getOwningSubagentId(child)
        const nestedAgent = child.kind === 'tool' && child.toolName === 'Agent'
        if (!nestedAgent && explicitChildOwnerId && explicitChildOwnerId !== ownerId) {
          appendChild(ensureOwner(explicitChildOwnerId, child), child)
        } else {
          appendChild(owner, child)
        }
      }
      continue
    }

    const owningSubagentId = getOwningSubagentId(message)
    if (!owningSubagentId) {
      unowned.push(message)
      continue
    }
    appendChild(ensureOwner(owningSubagentId, message), message)
  }

  return {
    subagents: ownerOrder.map((id) => {
      const owner = owners.get(id)!
      const message = owner.children.length > 0
        ? { ...owner.message, children: owner.children }
        : owner.message
      return {
        id,
        message,
        toolCallCount: countNestedToolCalls(owner.children),
      }
    }),
    unowned,
  }
}

function isOperationalActivity(message: MsgItem): boolean {
  return message.kind === 'tool'
    || message.kind === 'provider'
    || message.kind === 'thinking'
}

export function groupMessages(messages: MsgItem[]): RenderItem[] {
  const result: RenderItem[] = []
  let activityBuffer: MsgItem[] = []

  function flushActivity() {
    if (activityBuffer.length === 0) {
      return
    }
    result.push({
      type: 'activity-group',
      id: `ag-${activityBuffer[0].id}`,
      messages: activityBuffer,
    })
    activityBuffer = []
  }

  for (const message of messages) {
    if (isOperationalActivity(message)) {
      activityBuffer.push(message)
    } else {
      flushActivity()
      result.push({ type: 'single', msg: message })
    }
  }

  flushActivity()
  return result
}
