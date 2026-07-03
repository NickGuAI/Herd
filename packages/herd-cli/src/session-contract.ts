const COMMANDER_SESSION_NAME_PREFIX = 'commander-'

export type SessionType = 'commander' | 'worker' | 'automation'
export type SessionCreatorKind = 'human' | 'commander' | 'automation'

export interface SessionCreator {
  kind: SessionCreatorKind
  id?: string
}

export interface CommanderOwnedSessionLike {
  creator?: SessionCreator | null
}

export type ConversationSurface = 'discord' | 'telegram' | 'whatsapp' | 'ui' | 'cli' | 'api'
export type ConversationStatus = 'active' | 'idle' | 'archived'
export type ConversationCreationSource = 'ui' | 'cli' | 'api' | 'channel' | 'system-default' | 'unknown'
export type ConversationCreatedByKind = 'human' | 'api-key' | 'system' | 'channel' | 'unknown'

export interface ProviderContext {
  providerId: string
  sessionId?: string
  threadId?: string
  effort?: string
  adaptiveThinking?: string
  maxThinkingTokens?: number
}

export interface Conversation {
  id: string
  commanderId: string
  isDefaultConversation?: boolean
  surface: ConversationSurface
  channelMeta?: Record<string, unknown>
  lastRoute?: Record<string, unknown>
  agentType?: string | null
  model?: string | null
  name: string
  status: ConversationStatus
  currentTask: Record<string, unknown> | null
  providerContext?: ProviderContext
  lastHeartbeat: string | null
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  creationSource?: ConversationCreationSource
  createdByKind?: ConversationCreatedByKind
  createdById?: string
  createdBySessionName?: string
  createdByConversationId?: string
  requestId?: string
  createdAt: string
  lastMessageAt: string
}

export interface WorkerLifecycleSessionLike {
  status?: string | null
  processAlive?: boolean | null
  completed?: boolean | null
}

export type WorkerLifecycle = 'running' | 'stale' | 'exited' | 'completed'
export type AgentRuntimeSessionState = 'active' | 'paused' | 'archived'
export type RuntimeSessionAllowedActions = Record<string, boolean>
export type RuntimeSessionDisabledReasons = Record<string, string | null>

export function normalizeSessionType(value: unknown): SessionType | null {
  if (value === 'commander' || value === 'worker' || value === 'automation') {
    return value
  }
  if (value === 'cron' || value === 'sentinel') {
    return 'automation'
  }
  return null
}

export function normalizeSessionCreator(value: unknown): SessionCreator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rawKind = 'kind' in value ? value.kind : undefined
  if (rawKind !== 'human' && rawKind !== 'commander' && rawKind !== 'automation' && rawKind !== 'cron' && rawKind !== 'sentinel') {
    return null
  }

  const rawId = 'id' in value ? value.id : undefined
  const id = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined
  const kind: SessionCreatorKind = rawKind === 'cron' || rawKind === 'sentinel'
    ? 'automation'
    : rawKind
  return { kind, ...(id ? { id } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeRuntimeSessionState(value: unknown): AgentRuntimeSessionState | null {
  if (value === 'active' || value === 'paused' || value === 'archived') {
    return value
  }
  return null
}

export function parseRuntimeSessionAllowedActions(value: unknown): RuntimeSessionAllowedActions | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const parsed: RuntimeSessionAllowedActions = {}
  for (const [key, actionValue] of Object.entries(value)) {
    const action = key.trim()
    if (!action || typeof actionValue !== 'boolean') {
      continue
    }
    parsed[action] = actionValue
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined
}

export function parseRuntimeSessionDisabledReasons(value: unknown): RuntimeSessionDisabledReasons | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const parsed: RuntimeSessionDisabledReasons = {}
  for (const [key, reasonValue] of Object.entries(value)) {
    const action = key.trim()
    if (!action) {
      continue
    }
    if (reasonValue === null) {
      parsed[action] = null
      continue
    }
    if (typeof reasonValue === 'string') {
      const reason = reasonValue.trim()
      parsed[action] = reason.length > 0 ? reason : null
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined
}

export function formatRuntimeAllowedActions(actions: RuntimeSessionAllowedActions | undefined): string | null {
  if (!actions) {
    return null
  }

  const allowed = Object.entries(actions)
    .filter(([, allowedAction]) => allowedAction)
    .map(([action]) => action)
  return allowed.length > 0 ? allowed.join(', ') : 'none'
}

export function formatRuntimeDisabledReasons(reasons: RuntimeSessionDisabledReasons | undefined): string | null {
  if (!reasons) {
    return null
  }

  const disabled = Object.entries(reasons)
    .filter(([, reason]) => reason !== null)
    .map(([action, reason]) => `${action}=${reason}`)
  return disabled.length > 0 ? disabled.join('; ') : null
}

export function buildCommanderSessionName(commanderId: string): string {
  return `${COMMANDER_SESSION_NAME_PREFIX}${commanderId.trim()}`
}

export function isOwnedByCommander(
  session: CommanderOwnedSessionLike,
  commanderId: string,
): boolean {
  return (
    session.creator?.kind === 'commander'
    && session.creator.id?.trim() === commanderId.trim()
  )
}

export function workerLifecycle(session: WorkerLifecycleSessionLike): WorkerLifecycle {
  const status = (session.status ?? '').trim().toLowerCase()

  if (status === 'exited' || session.processAlive === false) {
    return 'exited'
  }
  if (session.completed || status === 'completed') {
    return 'completed'
  }
  if (status === 'stale') {
    return 'stale'
  }
  return 'running'
}

export function workerLifecycleFromRuntimeState(
  state: AgentRuntimeSessionState | null | undefined,
): WorkerLifecycle | null {
  if (state === 'active') {
    return 'running'
  }
  if (state === 'paused') {
    return 'stale'
  }
  if (state === 'archived') {
    return 'exited'
  }
  return null
}

export function workerLifecycleWithRuntimeState(
  session: WorkerLifecycleSessionLike & { state?: AgentRuntimeSessionState | null },
): WorkerLifecycle {
  return workerLifecycleFromRuntimeState(session.state) ?? workerLifecycle(session)
}
