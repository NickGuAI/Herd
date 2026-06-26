import type { TranscriptEnvelope, TranscriptEnvelopeEvent } from '../../../src/types/transcript-envelope.js'
import { classifyProviderError } from '../provider-errors.js'
import { createTranscriptId } from '../transcript-id.js'

interface ClaudeStreamEvent {
  type: string
  [key: string]: unknown
}

export interface ClaudeTranscriptMapper {
  map(rawEvent: unknown): TranscriptEnvelope[]
}

type ClaudeTurnEndStatus = Extract<TranscriptEnvelopeEvent, { type: 'turn.end' }>['status']

interface SyntheticClaudeEnvelopeOptions {
  sessionId?: string
  itemId?: string
  clientSendId?: string
}

interface StreamingToolUseState {
  toolCallId: string
  toolName: string
  inputJsonParts: string[]
  emittedStart: boolean
}

const CLAUDE_TASK_SYSTEM_SUBTYPES = new Set([
  'task_progress',
  'task_started',
  'task_notification',
])

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

function readCodeString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return readTrimmedString(value)
}

function readTimestamp(event: ClaudeStreamEvent): string {
  return readTrimmedString(event.timestamp) ?? new Date().toISOString()
}

function readSessionId(event: ClaudeStreamEvent): string | undefined {
  const message = asObject(event.message)
  const metadata = asObject(message?.metadata)
  return readTrimmedString(event.session_id)
    ?? readTrimmedString(event.sessionId)
    ?? readTrimmedString(metadata?.session_id)
    ?? readTrimmedString(metadata?.sessionId)
}

function readRawEventId(event: ClaudeStreamEvent): string | undefined {
  const message = asObject(event.message)
  const contentBlock = asObject(event.content_block)
  return readTrimmedString(event.id)
    ?? readTrimmedString(event.toolId)
    ?? readTrimmedString(event.tool_use_id)
    ?? readTrimmedString(message?.id)
    ?? readTrimmedString(contentBlock?.id)
}

function readToolId(event: ClaudeStreamEvent): string | undefined {
  const message = asObject(event.message)
  const contentBlock = asObject(event.content_block)
  return readTrimmedString(event.toolId)
    ?? readTrimmedString(event.tool_use_id)
    ?? readTrimmedString(event.id)
    ?? readTrimmedString(contentBlock?.id)
    ?? readTrimmedString(message?.id)
}

function readParentToolUseId(event: ClaudeStreamEvent): string | undefined {
  return readTrimmedString(event.parent_tool_use_id)
}

function readTaskToolUseId(event: ClaudeStreamEvent): string | undefined {
  if (event.type !== 'system') {
    return undefined
  }
  const subtype = readTrimmedString(event.subtype)
  if (!subtype || !CLAUDE_TASK_SYSTEM_SUBTYPES.has(subtype)) {
    return undefined
  }
  return readTrimmedString(event.tool_use_id)
}

function readSubagentId(event: ClaudeStreamEvent): string | undefined {
  return readParentToolUseId(event) ?? readTaskToolUseId(event)
}

function withAgentSubagentId<T extends Record<string, unknown>>(
  event: ClaudeStreamEvent,
  toolName: string,
  toolCallId: string,
  overrides: T,
): T & { subagentId?: string } {
  return toolName === 'Agent'
    ? { ...overrides, subagentId: toolCallId }
    : overrides
}

function readContentBlockItemId(event: ClaudeStreamEvent): string | undefined {
  const contentBlock = asObject(event.content_block)
  const contentBlockId = readTrimmedString(contentBlock?.id)
  if (contentBlockId) {
    return contentBlockId
  }
  return typeof event.index === 'number' && Number.isFinite(event.index)
    ? `content-block-${event.index}`
    : undefined
}

function readContentBlockIndexKey(event: ClaudeStreamEvent): string | undefined {
  return typeof event.index === 'number' && Number.isFinite(event.index)
    ? String(event.index)
    : undefined
}

function envelope(
  event: ClaudeStreamEvent,
  ev: TranscriptEnvelopeEvent,
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const sessionId = readSessionId(event)
  const rawEventId = readRawEventId(event)
  const subagentId = overrides.subagentId ?? readSubagentId(event)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: readTimestamp(event),
    source: {
      provider: 'claude',
      backend: 'cli',
      ...(sessionId ? { sessionId } : {}),
      rawEventType: event.type,
      ...(rawEventId ? { rawEventId } : {}),
    },
    ...(subagentId ? { subagentId } : {}),
    ev,
    ...overrides,
  }
}

function createClaudeSyntheticEnvelope(
  rawEventType: string,
  ev: TranscriptEnvelopeEvent,
  options: SyntheticClaudeEnvelopeOptions = {},
): TranscriptEnvelope {
  return envelope({
    type: rawEventType,
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
    ...(options.itemId ? { id: options.itemId } : {}),
  }, ev, {
    ...(options.itemId ? { itemId: options.itemId } : {}),
    ...(options.clientSendId ? { clientSendId: options.clientSendId } : {}),
  })
}

export function createClaudeProviderActivityEnvelope(
  title: string,
  data: unknown,
  sessionId?: string,
): TranscriptEnvelope {
  return createClaudeSyntheticEnvelope(
    'herd/provider-activity',
    { type: 'provider.activity', title, data },
    { sessionId },
  )
}

export function createClaudeProviderErrorEnvelope(
  message: string,
  data: unknown,
  sessionId?: string,
  code?: string,
  hint?: string,
): TranscriptEnvelope {
  return createClaudeSyntheticEnvelope(
    'herd/provider-error',
    {
      type: 'provider.error',
      message,
      classification: classifyProviderError(message, code),
      ...(code ? { code } : {}),
      ...(hint ? { hint } : {}),
      retryable: false,
      data,
    },
    { sessionId },
  )
}

export function createClaudeTurnEndEnvelope(
  status: ClaudeTurnEndStatus,
  result: unknown,
  sessionId?: string,
): TranscriptEnvelope {
  return createClaudeSyntheticEnvelope(
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

export function createClaudeUserTranscriptEnvelopes(
  text: string,
  options: {
    sessionId?: string
    displayText?: string
    clientSendId?: string
    images?: Array<{ mediaType: string; data: string }>
  } = {},
): TranscriptEnvelope[] {
  const clientSendId = options.clientSendId?.trim()
  const itemId = clientSendId || createTranscriptId()
  const displayText = options.displayText !== undefined
    ? options.displayText.trim()
    : undefined
  const visibleText = displayText !== undefined
    ? (displayText || (options.images?.length ? '[image]' : '[workspace context]'))
    : text.trim()
  const envelopeOptions = {
    sessionId: options.sessionId,
    itemId,
    ...(clientSendId ? { clientSendId } : {}),
  }
  const events: TranscriptEnvelope[] = [
    createClaudeSyntheticEnvelope('herd/user', { type: 'message.start', role: 'user' }, envelopeOptions),
  ]
  if (visibleText) {
    events.push(createClaudeSyntheticEnvelope(
      'herd/user',
      { type: 'message.delta', text: visibleText, channel: 'final' },
      envelopeOptions,
    ))
  }
  for (const image of options.images ?? []) {
    events.push(createClaudeSyntheticEnvelope(
      'herd/user',
      {
        type: 'message.image',
        role: 'user',
        image: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mediaType,
            data: image.data,
          },
        },
      },
      envelopeOptions,
    ))
  }
  events.push(createClaudeSyntheticEnvelope('herd/user', { type: 'message.end' }, envelopeOptions))
  return events
}

function formatTaskSystemTitle(event: ClaudeStreamEvent): string | undefined {
  const subtype = readTrimmedString(event.subtype)
  if (!subtype || !CLAUDE_TASK_SYSTEM_SUBTYPES.has(subtype)) {
    return undefined
  }
  const description = readTrimmedString(event.description)
  const summary = readTrimmedString(event.summary)
  const status = readTrimmedString(event.status)
  if (subtype === 'task_progress') {
    const tool = readTrimmedString(event.last_tool_name)
    const parts = [description, tool ? `[${tool}]` : undefined].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : undefined
  }
  if (subtype === 'task_started') {
    return description ? `Sub-agent: ${description}` : undefined
  }
  return summary ?? description ?? (status ? `Sub-agent ${status}` : undefined)
}

function normalizeTurnStatus(
  subtype: string | undefined,
  isError: boolean | undefined,
): Extract<TranscriptEnvelopeEvent, { type: 'turn.end' }>['status'] {
  if (isError) {
    return 'error'
  }
  const normalized = subtype?.trim().toLowerCase()
  switch (normalized) {
    case 'failed':
    case 'error':
      return 'error'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'completed':
      return 'completed'
    case 'success':
    case 'ok':
      return 'ok'
    default:
      return 'ok'
  }
}

function isTerminalTurnEndStatus(status: ClaudeTurnEndStatus): boolean {
  const normalized = status?.trim().toLowerCase()
  return normalized === 'error' || normalized === 'failed' || normalized === 'failure'
}

function normalizeTextPayload(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const parts = value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry
      }
      const record = asObject(entry)
      return readTrimmedString(record?.text)
    })
    .filter((entry): entry is string => Boolean(entry))
  return parts.length > 0 ? parts.join('\n').trim() : undefined
}

function readClaudeResultErrorMessage(event: ClaudeStreamEvent): string {
  return normalizeTextPayload(event.result)
    ?? normalizeTextPayload(event.error)
    ?? readTrimmedString(event.message)
    ?? `Claude turn ended with ${readTrimmedString(event.subtype) ?? 'an error'}`
}

function readClaudeResultErrorCode(event: ClaudeStreamEvent): string | undefined {
  return readCodeString(event.api_error_status)
    ?? readCodeString(event.api_error_code)
    ?? readCodeString(event.error_code)
    ?? readCodeString(event.code)
    ?? readCodeString(event.subtype)
}

function parseToolResultPayload(content: unknown): Record<string, unknown> | null {
  const directRecord = asObject(content)
  if (directRecord) {
    return directRecord
  }
  const text = normalizeTextPayload(content)
  if (!text) {
    return null
  }
  try {
    return asObject(JSON.parse(text))
  } catch {
    return null
  }
}

function normalizeThinkingBlock(block: Record<string, unknown>): Record<string, unknown> {
  const rawText =
    typeof block.thinking === 'string'
      ? block.thinking
      : (typeof block.text === 'string' ? block.text : '')
  const trimmed = rawText.trim()
  if (trimmed.length > 0) {
    return { ...block, thinking: trimmed }
  }
  const signature = typeof block.signature === 'string' ? block.signature : ''
  if (signature.length > 0) {
    return {
      ...block,
      thinking: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
    }
  }
  return block
}

function planningToolUseToEnvelopes(
  event: ClaudeStreamEvent,
  block: Record<string, unknown>,
): TranscriptEnvelope[] | null {
  const name = readTrimmedString(block.name)
  if (name === 'EnterPlanMode') {
    return [envelope(event, {
      type: 'plan.update',
      plan: { action: 'enter' },
    })]
  }
  if (name !== 'ExitPlanMode') {
    return null
  }
  const input = asObject(block.input)
  const plan = readTrimmedString(input?.plan)
  if (!plan) {
    return null
  }
  const toolId = readTrimmedString(block.id)
  if (!toolId) {
    return [envelope(event, {
      type: 'plan.update',
      plan: { action: 'proposed', plan },
    })]
  }
  const providerContext = {
    provider: 'claude',
    backend: 'cli',
    toolUseId: toolId,
    toolName: 'ExitPlanMode',
    answerFormat: 'claude.exit_plan_mode',
  }
  return [
    envelope(event, { type: 'plan.update', plan }, { itemId: toolId }),
    envelope(event, {
      type: 'approval.request',
      toolCallId: toolId,
      interactionKind: 'plan_approval',
      prompt: plan,
      request: {
        toolName: 'ExitPlanMode',
        approveLabel: 'Approve',
        rejectLabel: 'Reject',
        customResponseLabel: 'Add response',
        interactionKind: 'plan_approval',
        providerContext,
      },
    }, { itemId: toolId }),
  ]
}

function planningToolResultToEnvelopes(
  event: ClaudeStreamEvent,
  block: Record<string, unknown>,
): TranscriptEnvelope[] | null {
  const payload = parseToolResultPayload(block.content)
  const explicitToolName = readTrimmedString(block.name ?? block.tool_name ?? block.toolUseName)
  const toolId = readTrimmedString(block.tool_use_id)
  const plan = readTrimmedString(payload?.plan)
  if (plan) {
    return [envelope(event, {
      type: 'plan.update',
      plan: { action: 'proposed', plan },
      ...(toolId ? { toolCallId: toolId } : {}),
    }, toolId ? { itemId: toolId } : {})]
  }
  const approved = typeof payload?.approved === 'boolean' ? payload.approved : undefined
  const message = readTrimmedString(payload?.message)
  if (approved === undefined && !message) {
    return null
  }
  if (approved === undefined && explicitToolName !== 'ExitPlanMode') {
    return null
  }
  const records = [envelope(event, {
    type: 'plan.update',
    plan: {
      action: 'decision',
      ...(approved !== undefined ? { approved } : {}),
      ...(message ? { message } : {}),
    },
    ...(toolId ? { toolCallId: toolId } : {}),
  }, toolId ? { itemId: toolId } : {})]
  if (toolId) {
    records.push(envelope(event, {
      type: 'approval.resolved',
      toolCallId: toolId,
      ...(approved !== undefined ? { approved } : {}),
      result: message,
    }, { itemId: toolId }))
  }
  return records
}

function assistantBlocksToEnvelopes(
  event: ClaudeStreamEvent,
  message: Record<string, unknown>,
  blocks: readonly unknown[],
): TranscriptEnvelope[] {
  const result: TranscriptEnvelope[] = []
  const itemId = readTrimmedString(message.id)
  let startedMessage = false
  const ensureMessageStarted = () => {
    if (!startedMessage) {
      result.push(envelope(event, { type: 'message.start', role: 'assistant' }, itemId ? { itemId } : {}))
      startedMessage = true
    }
  }
  for (const rawBlock of blocks) {
    const block = asObject(rawBlock)
    if (!block) {
      continue
    }
    if (block.type === 'text') {
      ensureMessageStarted()
      const text = typeof block.text === 'string' ? block.text : ''
      if (text) {
        result.push(envelope(event, { type: 'message.delta', text, channel: 'final' }, itemId ? { itemId } : {}))
      }
      continue
    }
    if (block.type === 'image') {
      ensureMessageStarted()
      result.push(envelope(event, { type: 'message.image', image: block as never, role: 'assistant' }, itemId ? { itemId } : {}))
      continue
    }
    if (block.type === 'thinking') {
      const normalizedBlock = normalizeThinkingBlock(block)
      const text = typeof normalizedBlock.thinking === 'string'
        ? normalizedBlock.thinking
        : readTrimmedString(normalizedBlock.text)
      if (text) {
        result.push(envelope(event, { type: 'thinking.delta', text }, itemId ? { itemId } : {}))
      }
      continue
    }
    if (block.type === 'tool_use') {
      const toolCallId = readTrimmedString(block.id) ?? createTranscriptId()
      const toolName = readTrimmedString(block.name) ?? 'Tool'
      result.push(envelope(event, {
        type: 'tool.start',
        toolCallId,
        name: toolName,
        input: block.input,
      }, withAgentSubagentId(event, toolName, toolCallId, {
        itemId: toolCallId,
        ...(itemId ? { parentId: itemId } : {}),
      })))
    }
  }
  if (startedMessage) {
    result.push(envelope(event, { type: 'message.end' }, itemId ? { itemId } : {}))
  }
  return result
}

function userBlocksToEnvelopes(
  event: ClaudeStreamEvent,
  content: unknown,
): TranscriptEnvelope[] {
  const result: TranscriptEnvelope[] = []
  if (typeof content === 'string') {
    result.push(envelope(event, { type: 'message.start', role: 'user' }))
    if (content) {
      result.push(envelope(event, { type: 'message.delta', text: content, channel: 'final' }))
    }
    result.push(envelope(event, { type: 'message.end' }))
    return result
  }
  const blocks = Array.isArray(content) ? content : []
  let startedMessage = false
  const ensureMessageStarted = () => {
    if (!startedMessage) {
      result.push(envelope(event, { type: 'message.start', role: 'user' }))
      startedMessage = true
    }
  }
  for (const rawBlock of blocks) {
    const block = asObject(rawBlock)
    if (!block) {
      continue
    }
    if (block.type === 'tool_result') {
      const planningEvents = planningToolResultToEnvelopes(event, block)
      if (planningEvents) {
        result.push(...planningEvents)
        continue
      }
      const toolCallId = readTrimmedString(block.tool_use_id) ?? createTranscriptId()
      result.push(envelope(event, {
        type: 'tool.end',
        toolCallId,
        status: block.is_error ? 'error' : 'ok',
        result: block.content,
        ...(block.is_error ? { error: block.content } : {}),
      }, { itemId: toolCallId, parentId: readToolId(event) }))
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      ensureMessageStarted()
      result.push(envelope(event, { type: 'message.delta', text: block.text, channel: 'final' }))
      continue
    }
    if (block.type === 'image') {
      ensureMessageStarted()
      result.push(envelope(event, { type: 'message.image', image: block as never, role: 'user' }))
    }
  }
  if (startedMessage) {
    result.push(envelope(event, { type: 'message.end' }))
  }
  return result
}

function mapAssistantEvent(event: ClaudeStreamEvent): TranscriptEnvelope[] {
  const message = asObject(event.message) ?? {}
  const content = message.content
  if (!Array.isArray(content)) {
    return [envelope(event, {
      type: 'provider.raw',
      method: event.type,
      payload: event,
    })]
  }
  const result: TranscriptEnvelope[] = []
  let passthroughBlocks: unknown[] = []
  const flushPassthrough = () => {
    if (passthroughBlocks.length === 0) {
      return
    }
    result.push(...assistantBlocksToEnvelopes(event, message, passthroughBlocks))
    passthroughBlocks = []
  }
  for (const rawBlock of content) {
    const block = asObject(rawBlock)
    const planningEvents = block?.type === 'tool_use'
      ? planningToolUseToEnvelopes(event, block)
      : null
    if (!planningEvents) {
      passthroughBlocks.push(block?.type === 'thinking' ? normalizeThinkingBlock(block) : rawBlock)
      continue
    }
    flushPassthrough()
    result.push(...planningEvents)
  }
  flushPassthrough()
  return result
}

function mapMessageStart(event: ClaudeStreamEvent): TranscriptEnvelope[] {
  const message = asObject(event.message)
  const itemId = readTrimmedString(message?.id)
  const role = message?.role === 'user' || message?.role === 'system'
    ? message.role
    : 'assistant'
  return [
    envelope(event, { type: 'turn.start', role }, itemId ? { itemId } : {}),
    envelope(event, { type: 'message.start', role }, itemId ? { itemId } : {}),
  ]
}

function mapContentBlockStart(event: ClaudeStreamEvent): TranscriptEnvelope[] {
  const contentBlock = asObject(event.content_block)
  const blockType = readTrimmedString(contentBlock?.type)
  if (blockType === 'text') {
    const itemId = readContentBlockItemId(event)
    return [envelope(event, { type: 'message.start', role: 'assistant' }, itemId ? { itemId } : {})]
  }
  if (blockType === 'thinking') {
    return []
  }
  if (blockType === 'image') {
    const itemId = readContentBlockItemId(event)
    return [envelope(event, { type: 'message.image', image: contentBlock as never, role: 'assistant' }, itemId ? { itemId } : {})]
  }
  if (blockType === 'tool_use') {
    const toolCallId = readTrimmedString(contentBlock?.id) ?? createTranscriptId()
    const toolName = readTrimmedString(contentBlock?.name) ?? 'Tool'
    const planningEvents = planningToolUseToEnvelopes(event, {
      ...contentBlock,
      id: toolCallId,
      name: toolName,
    })
    if (planningEvents) {
      return planningEvents
    }
    return [envelope(event, {
      type: 'tool.start',
      toolCallId,
      name: toolName,
      input: contentBlock?.input,
    }, withAgentSubagentId(event, toolName, toolCallId, { itemId: toolCallId }))]
  }
  return []
}

function mapContentBlockDelta(event: ClaudeStreamEvent): TranscriptEnvelope[] {
  const delta = asObject(event.delta)
  const itemId = readContentBlockItemId(event)
  const identity = itemId ? { itemId } : {}
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
    return [envelope(event, { type: 'message.delta', text: delta.text, channel: 'final' }, identity)]
  }
  if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    return [envelope(event, { type: 'thinking.delta', text: delta.thinking }, identity)]
  }
  if (delta?.type === 'input_json_delta') {
    const toolCallId = readToolId(event) ?? itemId ?? createTranscriptId()
    return [envelope(event, {
      type: 'tool.delta',
      toolCallId,
      status: 'running',
      patch: { partial_json: delta.partial_json },
      data: { partial_json: delta.partial_json },
    }, { ...identity, itemId: itemId ?? toolCallId })]
  }
  return []
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  try {
    return asObject(JSON.parse(trimmed))
  } catch {
    return null
  }
}

function buildToolUseEvent(
  event: ClaudeStreamEvent,
  state: StreamingToolUseState,
  input: unknown,
): ClaudeStreamEvent {
  return {
    ...event,
    type: 'content_block_start',
    content_block: {
      type: 'tool_use',
      id: state.toolCallId,
      name: state.toolName,
      input,
    },
  }
}

function hasMeaningfulToolInput(input: unknown): boolean {
  const record = asObject(input)
  if (!record) {
    return typeof input === 'string' && input.trim().length > 0
  }
  return Object.keys(record).length > 0
}

export function createClaudeTranscriptMapper(): ClaudeTranscriptMapper {
  const streamingToolUses = new Map<string, StreamingToolUseState>()

  return {
    map(rawEvent: unknown): TranscriptEnvelope[] {
      const event = asObject(rawEvent) as ClaudeStreamEvent | null
      if (!event || !readTrimmedString(event.type)) {
        return [envelope({ type: 'provider.raw' }, {
          type: 'provider.raw',
          payload: rawEvent,
        })]
      }

      if (event.type === 'content_block_start') {
        const contentBlock = asObject(event.content_block)
        if (readTrimmedString(contentBlock?.type) === 'tool_use') {
          const indexKey = readContentBlockIndexKey(event)
          const toolCallId = readTrimmedString(contentBlock?.id) ?? createTranscriptId()
          const toolName = readTrimmedString(contentBlock?.name) ?? 'Tool'
          const state: StreamingToolUseState = {
            toolCallId,
            toolName,
            inputJsonParts: [],
            emittedStart: false,
          }
          if (indexKey) {
            streamingToolUses.set(indexKey, state)
          }

          if (!hasMeaningfulToolInput(contentBlock?.input) && toolName !== 'EnterPlanMode') {
            return []
          }

          const envelopes = mapContentBlockStart(event)
          state.emittedStart = envelopes.length > 0
          return envelopes
        }
      }

      if (event.type === 'content_block_delta') {
        const delta = asObject(event.delta)
        const indexKey = readContentBlockIndexKey(event)
        const state = indexKey ? streamingToolUses.get(indexKey) : undefined
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && state) {
          state.inputJsonParts.push(delta.partial_json)
          const parsedInput = parseJsonObject(state.inputJsonParts.join(''))
          if (!parsedInput) {
            return []
          }
          if (state.emittedStart) {
            return [envelope(event, {
              type: 'tool.delta',
              toolCallId: state.toolCallId,
              status: 'running',
              patch: { input: parsedInput },
              data: { input: parsedInput },
            }, { itemId: state.toolCallId })]
          }
          const envelopes = mapContentBlockStart(buildToolUseEvent(event, state, parsedInput))
          state.emittedStart = envelopes.length > 0
          return envelopes
        }
      }

      if (event.type === 'content_block_stop') {
        const indexKey = readContentBlockIndexKey(event)
        const state = indexKey ? streamingToolUses.get(indexKey) : undefined
        if (indexKey && state) {
          streamingToolUses.delete(indexKey)
          if (state.emittedStart) {
            return []
          }
          const rawInput = state.inputJsonParts.join('')
          const parsedInput = parseJsonObject(rawInput)
          return mapContentBlockStart(buildToolUseEvent(event, state, parsedInput ?? rawInput))
        }
      }

      return mapClaudeEvent(event)
    },
  }
}

function mapSystemEvent(event: ClaudeStreamEvent): TranscriptEnvelope[] {
  const text = typeof event.text === 'string' ? event.text : ''
  if (text) {
    return [
      envelope(event, { type: 'message.start', role: 'system' }),
      envelope(event, { type: 'message.delta', text, channel: 'system' }),
      envelope(event, { type: 'message.end' }),
    ]
  }
  return [envelope(event, {
    type: 'provider.activity',
    title: formatTaskSystemTitle(event) ?? `System ${readTrimmedString(event.subtype) ?? 'event'}`,
    data: event,
  })]
}

export function mapClaudeToTranscriptEnvelopes(rawEvent: unknown): TranscriptEnvelope[] {
  return createClaudeTranscriptMapper().map(rawEvent)
}

function mapClaudeEvent(event: ClaudeStreamEvent): TranscriptEnvelope[] {
  switch (event.type) {
    case 'assistant':
      return mapAssistantEvent(event)
    case 'user':
      {
        const message = asObject(event.message)
        return userBlocksToEnvelopes(event, message?.content)
      }
    case 'message_start':
      return mapMessageStart(event)
    case 'content_block_start':
      return mapContentBlockStart(event)
    case 'content_block_delta':
      return mapContentBlockDelta(event)
    case 'content_block_stop':
      {
        const itemId = readContentBlockItemId(event)
        return [envelope(event, { type: 'message.end' }, itemId ? { itemId } : {})]
      }
    case 'message_delta':
      return event.usage
        ? [envelope(event, {
            type: 'provider.activity',
            title: 'Usage updated',
            data: {
              usage: event.usage,
              usage_is_total: event.usage_is_total,
              total_cost_usd: event.total_cost_usd,
              cost_usd: event.cost_usd,
            },
          })]
        : []
    case 'message_stop':
      return [envelope(event, { type: 'message.end' })]
    case 'result':
      {
        const status = normalizeTurnStatus(readTrimmedString(event.subtype), event.is_error === true)
        const errorMessage = isTerminalTurnEndStatus(status)
          ? readClaudeResultErrorMessage(event)
          : undefined
        const errorCode = errorMessage ? readClaudeResultErrorCode(event) : undefined
        return [
          ...(event.usage || typeof event.total_cost_usd === 'number' || typeof event.cost_usd === 'number'
          ? [envelope(event, {
              type: 'provider.activity',
              title: 'Usage updated',
              data: {
                usage: event.usage,
                usage_is_total: true,
                total_cost_usd: event.total_cost_usd,
                cost_usd: event.cost_usd,
              },
            })]
          : []),
          ...(errorMessage
            ? [envelope(event, {
                type: 'provider.error',
                message: errorMessage,
                classification: classifyProviderError(errorMessage, errorCode),
                ...(errorCode ? { code: errorCode } : {}),
                retryable: false,
                data: event,
              })]
            : []),
          envelope(event, {
            type: 'turn.end',
            status,
            result: event.result,
            error: isTerminalTurnEndStatus(status) ? event.result : undefined,
            usage: event.usage as never,
          }),
        ]
      }
    case 'system':
      return mapSystemEvent(event)
    case 'agent':
      return typeof event.text === 'string'
        ? [
            envelope(event, { type: 'message.start', role: 'assistant' }),
            envelope(event, { type: 'message.delta', text: event.text, channel: 'final' }),
            envelope(event, { type: 'message.end' }),
          ]
        : []
    case 'tool_use':
      {
        const toolCallId = readTrimmedString(event.id) ?? createTranscriptId()
        const toolName = readTrimmedString(event.name) ?? 'Tool'
        return [envelope(event, {
          type: 'tool.start',
          toolCallId,
          name: toolName,
          input: event.input,
        }, withAgentSubagentId(event, toolName, toolCallId, { itemId: toolCallId }))]
      }
    case 'tool_result':
      {
        const toolCallId = readTrimmedString(event.tool_use_id) ?? createTranscriptId()
        return [envelope(event, {
          type: 'tool.end',
          toolCallId,
          status: event.is_error ? 'error' : 'ok',
          result: event.content,
          ...(event.is_error ? { error: event.content } : {}),
        }, { itemId: toolCallId, parentId: readToolId(event) })]
      }
    default:
      return [envelope(event, {
        type: 'provider.raw',
        method: event.type,
        payload: event,
      })]
  }
}
