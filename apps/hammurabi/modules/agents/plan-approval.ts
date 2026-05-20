import type {
  PlanApprovalDecision,
  PlanApprovalStreamEvent,
} from '../../src/types/hammurabi-events.js'
import { readOpenCodeRuntime } from './providers/provider-session-context.js'
import { getToolResultIds } from './session/state.js'
import type { StreamJsonEvent, StreamSession } from './types.js'

export type PlanApprovalEvent = Extract<StreamJsonEvent, { type: 'plan_approval' }>
export type ToolAnswerMap = Record<string, string | string[]>

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function firstToolAnswerValue(
  answers: ToolAnswerMap,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = answers[key]
    if (Array.isArray(value)) {
      const joined = value.map((entry) => String(entry).trim()).filter(Boolean).join(', ')
      if (joined) {
        return joined
      }
      continue
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

export function parsePlanApprovalDecision(value: string | undefined): PlanApprovalDecision | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  if (['approve', 'approved', 'yes', 'true'].includes(normalized)) {
    return 'approve'
  }
  if (['reject', 'rejected', 'no', 'false'].includes(normalized)) {
    return 'reject'
  }
  return null
}

export function findPlanApprovalEvent(
  session: StreamSession,
  toolId: string,
): PlanApprovalEvent | null {
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (event.type === 'plan_approval' && event.toolId === toolId) {
      return event
    }
  }
  return null
}

export function isPlanApprovalExpired(
  event: Pick<PlanApprovalStreamEvent, 'expiresAt' | 'autoResolveAfterMs' | 'source'> & Record<string, unknown>,
  nowMs: number,
): boolean {
  const expiresAtMs = parseIsoMs(event.expiresAt)
  if (expiresAtMs !== null) {
    return nowMs >= expiresAtMs
  }

  if (
    typeof event.autoResolveAfterMs !== 'number' ||
    !Number.isFinite(event.autoResolveAfterMs) ||
    event.autoResolveAfterMs < 0
  ) {
    return false
  }

  const anchorMs =
    parseIsoMs(event.source?.normalizedAt) ??
    parseIsoMs(event.createdAt) ??
    parseIsoMs(event.requestedAt)
  return anchorMs !== null && nowMs >= anchorMs + event.autoResolveAfterMs
}

export function findExpiredPendingPlanApproval(
  session: StreamSession,
  nowMs: number,
): PlanApprovalEvent | null {
  const answeredToolIds = new Set<string>()
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    for (const toolResultId of getToolResultIds(event)) {
      answeredToolIds.add(toolResultId)
    }

    if (event.type !== 'plan_approval') {
      continue
    }
    if (!event.toolId || answeredToolIds.has(event.toolId)) {
      continue
    }
    return isPlanApprovalExpired(event, nowMs) ? event : null
  }
  return null
}

export function buildPlanApprovalToolResultPayload(
  event: PlanApprovalEvent,
  decision: PlanApprovalDecision,
  message?: string,
): StreamJsonEvent {
  const approved = decision === 'approve'
  const trimmedMessage = message?.trim()
  const content = event.providerContext.answerFormat === 'opencode.plan_decision'
    ? {
        decision,
        approved,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
      }
    : {
        approved,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
      }

  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: event.toolId,
        content: JSON.stringify(content),
      }],
    },
  }
}

export function buildOpenCodePlanApprovalResult(
  event: PlanApprovalEvent,
  decision: PlanApprovalDecision,
  message?: string,
): { requestId: number | string; result: Record<string, unknown> } | null {
  if (event.providerContext.answerFormat !== 'opencode.plan_decision') {
    return null
  }
  const requestId = event.providerContext.requestId
  if (typeof requestId !== 'number' && typeof requestId !== 'string') {
    return null
  }
  const trimmedMessage = message?.trim()
  return {
    requestId,
    result: {
      decision,
      approved: decision === 'approve',
      ...(trimmedMessage ? { message: trimmedMessage } : {}),
    },
  }
}

export function deliverPlanApprovalDecision(
  session: StreamSession,
  event: PlanApprovalEvent,
  decision: PlanApprovalDecision,
  message: string | undefined,
  writeToStdin: (session: StreamSession, data: string) => boolean,
): { ok: true; payload: StreamJsonEvent } | { ok: false; reason: string } {
  const payload = buildPlanApprovalToolResultPayload(event, decision, message)
  const openCodeResult = buildOpenCodePlanApprovalResult(event, decision, message)
  if (openCodeResult) {
    const runtime = readOpenCodeRuntime(session)
    if (!runtime) {
      return { ok: false, reason: 'OpenCode runtime is unavailable' }
    }
    runtime.sendResponse(openCodeResult.requestId, openCodeResult.result)
    return { ok: true, payload }
  }

  const wrote = writeToStdin(session, `${JSON.stringify(payload)}\n`)
  if (!wrote) {
    return { ok: false, reason: 'Stream session unavailable' }
  }
  return { ok: true, payload }
}

export function buildPlanApprovalAutoResolvedSystemEvent(
  event: PlanApprovalEvent,
  decision: PlanApprovalDecision,
): Extract<StreamJsonEvent, { type: 'system' }> {
  return {
    type: 'system',
    subtype: 'plan_approval_auto_resolved',
    text: `Auto-resolved on heartbeat: ${decision}`,
    last_tool_name: event.toolName,
  }
}

export function buildToolAnswerPayload(
  session: StreamSession,
  toolId: string,
  answers: ToolAnswerMap,
): StreamJsonEvent | null {
  const planApproval = findPlanApprovalEvent(session, toolId)
  if (planApproval) {
    const decision = parsePlanApprovalDecision(firstToolAnswerValue(answers, ['decision', 'approved']))
    if (decision === null) {
      return null
    }
    const message = firstToolAnswerValue(answers, ['message', 'response', 'customResponse'])
    return buildPlanApprovalToolResultPayload(planApproval, decision, message)
  }

  // Keep the existing AskUserQuestion contract unchanged:
  // answers are string values, arrays become comma-separated strings.
  const serialized: Record<string, string> = {}
  for (const [key, val] of Object.entries(answers)) {
    serialized[key] = Array.isArray(val) ? val.join(', ') : String(val)
  }
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolId,
        content: JSON.stringify({ answers: serialized, annotations: {} }),
      }],
    },
  }
}
