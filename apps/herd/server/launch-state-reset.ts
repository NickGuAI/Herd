import type { DatabaseSync } from 'node:sqlite'
import type { QueuedMessage } from '../modules/agents/message-queue.js'
import { CommanderSessionStore } from '../modules/commanders/store.js'
import type { CommanderSession } from '../modules/commanders/store.js'

export interface LaunchStateResetOptions {
  sqliteDb: DatabaseSync
  commanderSessionStore?: Pick<CommanderSessionStore, 'list' | 'update'>
}

export interface LaunchStateResetResult {
  runtimeSessionsPaused: number
  commanderSessionsIdled: number
  errors: string[]
}

type ActiveRuntimeRow = {
  name: string
  session_type: string
  creator_kind: string
  creator_id: string | null
  conversation_id: string | null
  provider_resume_json: string
  runtime_state_json: string
}

interface RuntimeSessionPauseSummary {
  paused: number
}

function parseRecordJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function parseQueuedMessage(value: unknown): QueuedMessage | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string'
    || typeof record.text !== 'string'
    || typeof record.queuedAt !== 'string'
    || (record.priority !== 'high' && record.priority !== 'normal' && record.priority !== 'low')
  ) {
    return null
  }
  return {
    ...record,
    id: record.id,
    text: record.text,
    priority: record.priority,
    queuedAt: record.queuedAt,
  } as QueuedMessage
}

function parseQueuedMessages(value: unknown): QueuedMessage[] {
  return Array.isArray(value)
    ? value.map(parseQueuedMessage).filter((message): message is QueuedMessage => message !== null)
    : []
}

function dedupeQueuedMessages(messages: QueuedMessage[]): QueuedMessage[] {
  const seen = new Set<string>()
  return messages.filter((message) => {
    if (seen.has(message.id)) {
      return false
    }
    seen.add(message.id)
    return true
  })
}

function clearBootRuntimeState(value: string): string {
  const payload = parseRecordJson(value) ?? {}
  const queuedMessages = parseQueuedMessages(payload.queuedMessages)
  const pendingDirectSendMessages = parseQueuedMessages(payload.pendingDirectSendMessages)
  const currentQueuedMessage = parseQueuedMessage(payload.currentQueuedMessage)

  if (currentQueuedMessage) {
    if (currentQueuedMessage.priority === 'high') {
      pendingDirectSendMessages.unshift(currentQueuedMessage)
    } else {
      queuedMessages.unshift(currentQueuedMessage)
    }
  }

  delete payload.activeTurnId
  delete payload.currentQueuedMessage
  payload.hadResult = false

  const dedupedQueuedMessages = dedupeQueuedMessages(queuedMessages)
  const dedupedPendingDirectSendMessages = dedupeQueuedMessages(pendingDirectSendMessages)
  if (dedupedQueuedMessages.length > 0) {
    payload.queuedMessages = dedupedQueuedMessages
  } else {
    delete payload.queuedMessages
  }
  if (dedupedPendingDirectSendMessages.length > 0) {
    payload.pendingDirectSendMessages = dedupedPendingDirectSendMessages
  } else {
    delete payload.pendingDirectSendMessages
  }

  return JSON.stringify(payload)
}

function clearBootProviderResume(value: string): string {
  const payload = parseRecordJson(value)
  if (!payload) {
    return value
  }
  delete payload.daemonProcess
  return JSON.stringify(payload)
}

function isActiveCommanderConversationRuntime(row: ActiveRuntimeRow): boolean {
  return row.session_type === 'commander'
    && row.creator_kind === 'commander'
    && typeof row.conversation_id === 'string'
    && row.conversation_id.trim().length > 0
}

function pauseSqliteRuntimeSessions(sqliteDb: DatabaseSync): RuntimeSessionPauseSummary {
  const now = new Date().toISOString()
  const rows = sqliteDb.prepare(
    `SELECT name, session_type, creator_kind, creator_id, conversation_id, provider_resume_json, runtime_state_json
     FROM agent_runtime_sessions
     WHERE state = 'active'
     ORDER BY name ASC`,
  ).all() as ActiveRuntimeRow[]
  if (rows.length === 0) {
    return { paused: 0 }
  }

  const update = sqliteDb.prepare(
    `UPDATE agent_runtime_sessions
     SET state = 'paused',
         provider_resume_json = ?,
         runtime_state_json = ?,
         updated_at = ?,
         archived_at = NULL
     WHERE name = ? AND state = 'active'`,
  )
  const resetActiveConversation = sqliteDb.prepare(
    `UPDATE agent_runtime_sessions
     SET provider_resume_json = ?,
         runtime_state_json = ?,
         updated_at = ?,
         archived_at = NULL
     WHERE name = ? AND state = 'active'`,
  )

  sqliteDb.exec('BEGIN IMMEDIATE')
  try {
    let paused = 0
    for (const row of rows) {
      if (isActiveCommanderConversationRuntime(row)) {
        resetActiveConversation.run(
          clearBootProviderResume(row.provider_resume_json),
          clearBootRuntimeState(row.runtime_state_json),
          now,
          row.name,
        )
        continue
      }

      const result = update.run(
        clearBootProviderResume(row.provider_resume_json),
        clearBootRuntimeState(row.runtime_state_json),
        now,
        row.name,
      )
      paused += Number(result.changes)
    }
    sqliteDb.exec('COMMIT')
    return { paused }
  } catch (error) {
    sqliteDb.exec('ROLLBACK')
    throw error
  }
}

async function idleRunningCommanderSessions(
  store: Pick<CommanderSessionStore, 'list' | 'update'>,
): Promise<number> {
  const sessions = await store.list()
  let idled = 0
  for (const session of sessions) {
    if (session.state !== 'running') {
      continue
    }
    const updated = await store.update(
      session.id,
      (current: CommanderSession): CommanderSession => current.state === 'running'
        ? { ...current, state: 'idle' }
        : current,
    )
    if (updated?.state === 'idle') {
      idled += 1
    }
  }
  return idled
}

function formatResetError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${label}: ${message}`
}

export function shouldStopActiveSessionsOnBoot(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export async function resetActiveRuntimeStateForLaunch(
  options: LaunchStateResetOptions,
): Promise<LaunchStateResetResult> {
  const result: LaunchStateResetResult = {
    runtimeSessionsPaused: 0,
    commanderSessionsIdled: 0,
    errors: [],
  }

  try {
    const pauseSummary = pauseSqliteRuntimeSessions(options.sqliteDb)
    result.runtimeSessionsPaused = pauseSummary.paused
  } catch (error) {
    result.errors.push(formatResetError('agent runtime sessions', error))
  }

  try {
    result.commanderSessionsIdled = await idleRunningCommanderSessions(
      options.commanderSessionStore ?? new CommanderSessionStore(),
    )
  } catch (error) {
    result.errors.push(formatResetError('commander sessions', error))
  }

  return result
}
