import type { HerdUsage } from '../../../src/types/herd-events.js'
import type { TranscriptEnvelope, TranscriptEnvelopeEvent } from '../../../src/types/transcript-envelope.js'
import { createTranscriptId } from '../transcript-id.js'

type OpenCodeBlockType = 'text' | 'thinking'

export interface OpenCodeTurnState {
  nextBlockIndex: number
  openBlock: null | {
    index: number
    type: OpenCodeBlockType
  }
  lastCompletedBlock?: {
    index: number
    type: OpenCodeBlockType
  }
  lastPlanText?: string
  lastPlanApprovalToolId?: string
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readTrimmedId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return readTrimmedString(value)
}

function readProviderRequestId(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return readTrimmedString(value)
}

function readLowerString(value: unknown): string | undefined {
  return readTrimmedString(value)?.toLowerCase()
}

function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (value === undefined || value === null) {
    return undefined
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function blockItemId(index: number): string {
  return `content-block-${index}`
}

function closeOpenBlock(
  state: OpenCodeTurnState,
  update: Record<string, unknown>,
  options: { reusableForLateDelta?: boolean } = {},
): TranscriptEnvelope[] {
  if (!state.openBlock) {
    return []
  }
  const { index, type } = state.openBlock
  state.lastCompletedBlock = options.reusableForLateDelta
    ? { index, type }
    : undefined
  state.openBlock = null
  return [createOpenCodeEnvelope(update, { type: 'message.end' }, { itemId: blockItemId(index) })]
}

function openBlock(
  state: OpenCodeTurnState,
  type: OpenCodeBlockType,
  update: Record<string, unknown>,
): TranscriptEnvelope[] {
  if (state.openBlock?.type === type) {
    return []
  }

  const events = closeOpenBlock(state, update)
  if (!state.openBlock && state.lastCompletedBlock?.type === type) {
    state.openBlock = state.lastCompletedBlock
    state.lastCompletedBlock = undefined
    return events
  }

  const index = state.nextBlockIndex
  state.nextBlockIndex += 1
  state.openBlock = { index, type }
  state.lastCompletedBlock = undefined
  if (type === 'text') {
    events.push(createOpenCodeEnvelope(update, { type: 'message.start', role: 'assistant' }, {
      itemId: blockItemId(index),
    }))
  }
  return events
}

function extractChunkText(update: Record<string, unknown>): string | null {
  const content = asObject(update.content)
  if (!content || content.type !== 'text') {
    return null
  }
  return typeof content.text === 'string' && content.text.length > 0
    ? content.text
    : null
}

function deriveToolName(update: Record<string, unknown>): string {
  const kind = readTrimmedString(update.kind)
  if (kind === 'execute') return 'Bash'
  if (kind === 'edit') return 'Edit'
  if (kind === 'search') return 'Grep'
  if (kind === 'fetch') return 'WebFetch'
  if (kind === 'think') return 'Think'
  if (kind === 'switch_mode') return 'SwitchMode'
  return readTrimmedString(update.title) ?? 'Tool'
}

function extractToolOutput(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const parts = value
    .map((entry) => {
      const item = asObject(entry)
      if (!item) {
        return stringifyUnknown(entry)
      }
      if (item.type === 'content') {
        const wrapped = asObject(item.content)
        if (wrapped?.type === 'text' && typeof wrapped.text === 'string') {
          return wrapped.text
        }
      }
      return stringifyUnknown(item)
    })
    .filter((entry): entry is string => Boolean(entry))

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function extractPromptUsage(result: Record<string, unknown>): HerdUsage | undefined {
  const directUsage = asObject(result.usage)
  const quota = asObject(asObject(result._meta)?.quota)
  const tokenCount = asObject(quota?.token_count)

  const inputTokens = typeof directUsage?.inputTokens === 'number'
    ? directUsage.inputTokens
    : (typeof tokenCount?.input_tokens === 'number' ? tokenCount.input_tokens : undefined)
  const outputTokens = typeof directUsage?.outputTokens === 'number'
    ? directUsage.outputTokens
    : (typeof tokenCount?.output_tokens === 'number' ? tokenCount.output_tokens : undefined)
  const cacheReadInputTokens = typeof directUsage?.cachedReadTokens === 'number'
    ? directUsage.cachedReadTokens
    : undefined
  const cacheCreationInputTokens = typeof directUsage?.cachedWriteTokens === 'number'
    ? directUsage.cachedWriteTokens
    : undefined

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined
  ) {
    return undefined
  }

  return {
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cache_read_input_tokens: cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cache_creation_input_tokens: cacheCreationInputTokens } : {}),
  }
}

function formatPlan(update: Record<string, unknown>): string | undefined {
  const directPlan =
    readTrimmedString(update.plan) ??
    readTrimmedString(update.markdown) ??
    readTrimmedString(update.text)
  if (directPlan) {
    return directPlan
  }

  const entries = Array.isArray(update.entries) ? update.entries : []
  const lines = entries
    .map((entry) => {
      const item = asObject(entry)
      if (!item) {
        return null
      }
      const content = readTrimmedString(item.content)
      if (!content) {
        return null
      }
      const status = readTrimmedString(item.status)
      const marker = status === 'completed'
        ? '[x]'
        : (status === 'in_progress' ? '[>]' : '[ ]')
      return `${marker} ${content}`
    })
    .filter((entry): entry is string => Boolean(entry))

  return lines.length > 0 ? lines.join('\n') : undefined
}

function readPlanDefaultDecision(update: Record<string, unknown>): 'approve' | 'reject' | undefined {
  const value = readLowerString(update.defaultDecision)
  if (!value) {
    return undefined
  }
  if (['approve', 'approved', 'yes', 'true'].includes(value)) {
    return 'approve'
  }
  if (['reject', 'rejected', 'no', 'false'].includes(value)) {
    return 'reject'
  }
  return undefined
}

function readPlanAutoResolveAfterMs(update: Record<string, unknown>): number | undefined {
  const value = update.autoResolveAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function readPlanToolId(update: Record<string, unknown>): string | undefined {
  return readTrimmedId(update.toolCallId) ??
    readTrimmedId(update.toolUseId) ??
    readTrimmedId(update.toolId) ??
    readTrimmedId(update.requestId) ??
    readTrimmedId(update.id)
}

function isWaitingPlanUpdate(update: Record<string, unknown>): boolean {
  if (
    update.awaitingApproval === true ||
    update.requiresApproval === true ||
    update.needsApproval === true ||
    update.waitingForDecision === true ||
    update.blocking === true
  ) {
    return true
  }

  const waitingValues = new Set([
    'awaiting_approval',
    'awaiting approval',
    'blocked',
    'pending_approval',
    'requires_approval',
    'requires approval',
    'waiting',
    'waiting_for_approval',
    'waiting for approval',
    'waiting_for_decision',
    'waiting for decision',
  ])
  return [
    readLowerString(update.status),
    readLowerString(update.state),
    readLowerString(update.phase),
    readLowerString(update.decisionState),
  ].some((value) => Boolean(value && waitingValues.has(value)))
}

function buildPlanApprovalEnvelopes(update: Record<string, unknown>, plan: string): TranscriptEnvelope[] {
  if (!isWaitingPlanUpdate(update)) {
    return []
  }
  const toolId = readPlanToolId(update)
  if (!toolId) {
    return []
  }
  const toolName = readTrimmedString(update.toolName) ?? 'PlanApproval'
  const expiresAt = readTrimmedString(update.expiresAt)
  const autoResolveAfterMs = readPlanAutoResolveAfterMs(update)
  const defaultDecision = readPlanDefaultDecision(update)
  const request = {
    toolName,
    approveLabel: readTrimmedString(update.approveLabel) ?? 'Approve',
    rejectLabel: readTrimmedString(update.rejectLabel) ?? 'Reject',
    customResponseLabel: readTrimmedString(update.customResponseLabel) ?? 'Response',
    interactionKind: 'plan_approval',
    ...(expiresAt ? { expiresAt } : {}),
    ...(autoResolveAfterMs !== undefined ? { autoResolveAfterMs } : {}),
    ...(defaultDecision ? { defaultDecision } : {}),
    providerContext: {
      provider: 'opencode',
      backend: 'acp',
      toolUseId: toolId,
      toolName,
      ...(update.requestId !== undefined ? { requestId: readProviderRequestId(update.requestId) ?? String(update.requestId) } : {}),
      answerFormat: 'opencode.plan_decision',
    },
  }
  return [
    createOpenCodeEnvelope(update, { type: 'plan.update', plan }, { itemId: toolId }),
    createOpenCodeEnvelope(update, {
      type: 'approval.request',
      toolCallId: toolId,
      interactionKind: 'plan_approval',
      prompt: plan,
      ...(expiresAt ? { expiresAt } : {}),
      ...(autoResolveAfterMs !== undefined ? { autoResolveAfterMs } : {}),
      ...(defaultDecision ? { defaultDecision } : {}),
      request,
    }, { itemId: toolId }),
  ]
}

function describeStopReason(
  stopReason: string | undefined,
): { result: string; status: Extract<TranscriptEnvelopeEvent, { type: 'turn.end' }>['status']; isError?: boolean } {
  switch (stopReason) {
    case 'cancelled':
      return { result: 'Turn cancelled', status: 'cancelled' }
    case 'refusal':
      return { result: 'Model refused the request', status: 'error', isError: true }
    case 'max_tokens':
      return { result: 'Turn ended after reaching max tokens', status: 'ok' }
    case 'max_turn_requests':
      return { result: 'Turn ended after reaching max turn requests', status: 'ok' }
    default:
      return { result: 'Turn completed', status: 'ok' }
  }
}

function createOpenCodeEnvelope(
  update: Record<string, unknown>,
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  const itemId = overrides.itemId
    ?? readTrimmedId(update.id)
    ?? readTrimmedId(update.toolCallId)
  const turnId = overrides.turnId
    ?? readTrimmedId(update.turnId)
    ?? readTrimmedId(update.sessionId)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'opencode',
      backend: 'acp',
      ...(readTrimmedString(update.sessionId) ? { sessionId: readTrimmedString(update.sessionId) } : {}),
      ...(sessionUpdate ? { rawEventType: sessionUpdate } : {}),
      ...(itemId ? { rawEventId: itemId } : {}),
    },
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(overrides.parentId ? { parentId: overrides.parentId } : {}),
    ...(overrides.subagentId ? { subagentId: overrides.subagentId } : {}),
    ev,
  }
}

function createOpenCodeRawEnvelope(update: Record<string, unknown>): TranscriptEnvelope {
  return createOpenCodeEnvelope(update, {
    type: 'provider.raw',
    method: readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type),
    payload: update,
  })
}

function createOpenCodeRawPayloadEnvelope(payload: unknown): TranscriptEnvelope {
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'opencode',
      backend: 'acp',
    },
    ev: {
      type: 'provider.raw',
      payload,
    },
  }
}

type OpenCodeTurnEndStatus = Extract<TranscriptEnvelopeEvent, { type: 'turn.end' }>['status']

interface SyntheticOpenCodeEnvelopeOptions {
  sessionId?: string
  itemId?: string
  clientSendId?: string
}

function createOpenCodeSyntheticEnvelope(
  rawEventType: string,
  ev: TranscriptEnvelopeEvent,
  options: SyntheticOpenCodeEnvelopeOptions = {},
): TranscriptEnvelope {
  return createOpenCodeEnvelope({
    sessionUpdate: rawEventType,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.itemId ? { id: options.itemId } : {}),
  }, ev, {
    ...(options.itemId ? { itemId: options.itemId } : {}),
    ...(options.clientSendId ? { clientSendId: options.clientSendId } : {}),
  })
}

export function createOpenCodeAssistantStartEnvelope(sessionId?: string): TranscriptEnvelope {
  const itemId = createTranscriptId()
  return createOpenCodeSyntheticEnvelope(
    'herd/assistant-start',
    { type: 'message.start', role: 'assistant' },
    { sessionId, itemId },
  )
}

export function createOpenCodeProviderActivityEnvelope(
  title: string,
  data: unknown,
  sessionId?: string,
): TranscriptEnvelope {
  return createOpenCodeSyntheticEnvelope(
    'herd/provider-activity',
    { type: 'provider.activity', title, data },
    { sessionId },
  )
}

export function createOpenCodeTurnEndEnvelope(
  status: OpenCodeTurnEndStatus,
  result: unknown,
  sessionId?: string,
): TranscriptEnvelope {
  return createOpenCodeSyntheticEnvelope(
    'herd/turn-end',
    {
      type: 'turn.end',
      status,
      result,
      ...(status === 'error' || status === 'failed' ? { error: result } : {}),
    },
    { sessionId },
  )
}

export function createOpenCodeUserTranscriptEnvelopes(
  text: string,
  options: {
    sessionId?: string
    displayText?: string
    clientSendId?: string
  } = {},
): TranscriptEnvelope[] {
  const clientSendId = options.clientSendId?.trim()
  const itemId = clientSendId || createTranscriptId()
  const visibleText = options.displayText !== undefined
    ? options.displayText.trim()
    : text.trim()
  const envelopeOptions = {
    sessionId: options.sessionId,
    itemId,
    ...(clientSendId ? { clientSendId } : {}),
  }
  const events: TranscriptEnvelope[] = [
    createOpenCodeSyntheticEnvelope('herd/user', { type: 'message.start', role: 'user' }, envelopeOptions),
  ]
  if (visibleText) {
    events.push(createOpenCodeSyntheticEnvelope(
      'herd/user',
      { type: 'message.delta', text: visibleText, channel: 'final' },
      envelopeOptions,
    ))
  }
  events.push(createOpenCodeSyntheticEnvelope('herd/user', { type: 'message.end' }, envelopeOptions))
  return events
}

function readOpenCodeParentId(part: Record<string, unknown>): string | undefined {
  return readTrimmedId(part.parentId)
    ?? readTrimmedId(part.parentPartId)
    ?? readTrimmedId(part.parentToolCallId)
    ?? readTrimmedId(asObject(part.parent)?.id)
}

function mapOpenCodePart(update: Record<string, unknown>, rawPart: unknown): TranscriptEnvelope[] {
  const part = asObject(rawPart)
  if (!part) {
    return [createOpenCodeEnvelope(update, {
      type: 'provider.raw',
      method: `${readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type) ?? 'message'}/part`,
      payload: rawPart,
    })]
  }
  const partType = readTrimmedString(part.type)
  const partId = readTrimmedId(part.id) ?? readTrimmedId(part.toolCallId) ?? createTranscriptId()
  const subagentId = readTrimmedId(part.subagentId) ?? readTrimmedId(part.agentId)
  const parentId = readOpenCodeParentId(part)
  const identity = {
    itemId: partId,
    ...(subagentId ? { subagentId } : {}),
    ...(parentId ? { parentId } : {}),
  }
  switch (partType) {
    case 'text':
      return typeof part.text === 'string' && part.text.length > 0
        ? [createOpenCodeEnvelope(update, { type: 'message.delta', text: part.text, channel: 'final' }, identity)]
        : []
    case 'reasoning':
      return typeof part.text === 'string' && part.text.length > 0
        ? [createOpenCodeEnvelope(update, { type: 'thinking.delta', text: part.text }, identity)]
        : []
    case 'file':
    case 'patch':
      return [createOpenCodeEnvelope(update, {
        type: 'file.change',
        path: readTrimmedString(part.path) ?? readTrimmedString(part.file) ?? '',
        action: partType,
        data: part,
      }, identity)]
    case 'tool':
    case 'task':
    case 'subtask':
    case 'agent':
    case 'read':
    case 'glob':
    case 'mcp':
    case 'todowrite':
    case 'todo': {
      const status = readTrimmedString(part.status)
      if (status === 'completed' || status === 'failed') {
        return [createOpenCodeEnvelope(update, {
          type: 'tool.end',
          toolCallId: partId,
          status,
          result: part.output ?? part.result ?? part,
        }, identity)]
      }
      return [createOpenCodeEnvelope(update, {
        type: 'tool.start',
        toolCallId: partId,
        name: readTrimmedString(part.name) ?? readTrimmedString(part.title) ?? partType,
        input: part.input ?? part.args ?? part,
      }, identity)]
    }
    case 'step-start':
    case 'step-finish':
    case 'snapshot':
    case 'retry':
    case 'compaction':
      return [createOpenCodeEnvelope(update, {
        type: 'provider.activity',
        title: partType,
        data: part,
      }, identity)]
    default:
      return [createOpenCodeEnvelope(update, {
        type: 'provider.raw',
        method: `${readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type) ?? 'message'}/part:${partType ?? 'unknown'}`,
        payload: part,
      }, identity)]
  }
}

export function mapOpenCodeToTranscriptEnvelopes(
  rawUpdate: unknown,
  state: OpenCodeTurnState,
): TranscriptEnvelope[] {
  const update = asObject(rawUpdate)
  if (!update) {
    return [createOpenCodeRawPayloadEnvelope(rawUpdate)]
  }

  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  if (!sessionUpdate) {
    return [createOpenCodeRawEnvelope(update)]
  }

  if (sessionUpdate === 'tool_call_update') {
    const status = readTrimmedString(update.status)
    if (status && status !== 'completed' && status !== 'failed') {
      const toolCallId = readTrimmedString(update.toolCallId) ?? createTranscriptId()
      return [createOpenCodeEnvelope(update, {
        type: 'tool.delta',
        toolCallId,
        status,
        output: extractToolOutput(update.content) ?? stringifyUnknown(update.rawOutput),
        data: update,
      }, { itemId: toolCallId })]
    }
  }

  const mapped = mapOpenCodeSessionUpdate(update, state)
  if (mapped.length > 0) {
    return mapped
  }

  const parts = Array.isArray(update.parts)
    ? update.parts
    : (Array.isArray(asObject(update.message)?.parts) ? asObject(update.message)?.parts as unknown[] : [])
  const partEvents = parts.flatMap((part) => mapOpenCodePart(update, part))
  if (partEvents.length > 0) {
    return partEvents
  }

  if (
    sessionUpdate.includes('permission') ||
    sessionUpdate.includes('question') ||
    sessionUpdate.includes('todo') ||
    sessionUpdate.includes('status') ||
    sessionUpdate.startsWith('session') ||
    sessionUpdate.startsWith('message')
  ) {
    return [createOpenCodeEnvelope(update, {
      type: 'provider.activity',
      title: sessionUpdate,
      data: update,
    })]
  }

  return [createOpenCodeRawEnvelope(update)]
}

export function mapOpenCodePromptResponseToTranscriptEnvelopes(
  rawResult: unknown,
  state: OpenCodeTurnState,
): TranscriptEnvelope[] {
  const result = asObject(rawResult) ?? {}
  const stopReason = readTrimmedString(result.stopReason)
  const usage = extractPromptUsage(result)
  const finalResult = describeStopReason(stopReason)
  return [
    ...closeOpenBlock(state, result, { reusableForLateDelta: true }),
    ...(usage
      ? [createOpenCodeEnvelope(result, {
          type: 'provider.activity',
          title: 'Usage updated',
          data: { usage },
        })]
      : []),
    createOpenCodeEnvelope(result, { type: 'message.end' }),
    createOpenCodeEnvelope(result, {
      type: 'turn.end',
      status: finalResult.status,
      result: finalResult.result,
      ...(finalResult.isError ? { error: finalResult.result } : {}),
      ...(usage ? { usage } : {}),
    }),
  ]
}

export function createOpenCodeTurnState(): OpenCodeTurnState {
  return {
    nextBlockIndex: 0,
    openBlock: null,
  }
}

function mapOpenCodeSessionUpdate(
  update: Record<string, unknown>,
  state: OpenCodeTurnState,
): TranscriptEnvelope[] {
  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  if (!sessionUpdate) {
    return []
  }

  switch (sessionUpdate) {
    case 'agent_message_chunk': {
      const text = extractChunkText(update)
      if (!text) {
        return []
      }
      return [
        ...openBlock(state, 'text', update),
        createOpenCodeEnvelope(update, {
          type: 'message.delta',
          text,
          channel: 'final',
        }, { itemId: blockItemId(state.openBlock?.index ?? 0) }),
      ]
    }
    case 'agent_thought_chunk': {
      const thinking = extractChunkText(update)
      if (!thinking) {
        return []
      }
      return [
        ...openBlock(state, 'thinking', update),
        createOpenCodeEnvelope(update, {
          type: 'thinking.delta',
          text: thinking,
        }, { itemId: blockItemId(state.openBlock?.index ?? 0) }),
      ]
    }
    case 'tool_call': {
      const toolCallId = readTrimmedString(update.toolCallId) ?? createTranscriptId()
      return [
        ...closeOpenBlock(state, update),
        createOpenCodeEnvelope(update, {
          type: 'tool.start',
          toolCallId,
          name: deriveToolName(update),
          input: asObject(update.rawInput) ?? {},
        }, { itemId: toolCallId }),
      ]
    }
    case 'tool_call_update': {
      const status = readTrimmedString(update.status)
      if (status !== 'completed' && status !== 'failed') {
        return []
      }
      const toolCallId = readTrimmedString(update.toolCallId)
      if (!toolCallId) {
        return []
      }
      const content = extractToolOutput(update.content) ?? stringifyUnknown(update.rawOutput) ?? ''
      return [createOpenCodeEnvelope(update, {
        type: 'tool.end',
        toolCallId,
        status: status === 'failed' ? 'error' : 'ok',
        result: content,
        ...(status === 'failed' ? { error: content } : {}),
      }, { itemId: toolCallId })]
    }
    case 'plan': {
      const plan = formatPlan(update)
      if (!plan) {
        return []
      }
      const planApproval = buildPlanApprovalEnvelopes(update, plan)
      if (planApproval.length > 0) {
        const approvalToolId = planApproval.find((event) => event.ev.type === 'approval.request')?.itemId
        if (plan === state.lastPlanText && approvalToolId === state.lastPlanApprovalToolId) {
          return []
        }
        state.lastPlanText = plan
        state.lastPlanApprovalToolId = approvalToolId
        return planApproval
      }
      if (plan === state.lastPlanText) {
        return []
      }
      state.lastPlanText = plan
      state.lastPlanApprovalToolId = undefined
      return [createOpenCodeEnvelope(update, {
        type: 'plan.update',
        plan: { action: 'proposed', plan },
      })]
    }
    default:
      return []
  }
}
