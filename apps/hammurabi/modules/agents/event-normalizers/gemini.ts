import type { HammurabiUsage } from '../../../src/types/hammurabi-events.js'
import type { TranscriptEnvelope, TranscriptEnvelopeEvent } from '../../../src/types/transcript-envelope.js'
import { createTranscriptId } from '../transcript-id.js'

type GeminiBlockType = 'text' | 'thinking'

export interface GeminiTurnState {
  nextBlockIndex: number
  openBlock: null | {
    index: number
    type: GeminiBlockType
  }
  lastPlanText?: string
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

function closeOpenBlock(state: GeminiTurnState, update: Record<string, unknown>): TranscriptEnvelope[] {
  if (!state.openBlock) {
    return []
  }
  const { index } = state.openBlock
  state.openBlock = null
  return [createGeminiEnvelope(update, { type: 'message.end' }, { itemId: blockItemId(index) })]
}

function openBlock(
  state: GeminiTurnState,
  type: GeminiBlockType,
  update: Record<string, unknown>,
): TranscriptEnvelope[] {
  if (state.openBlock?.type === type) {
    return []
  }

  const events = closeOpenBlock(state, update)
  const index = state.nextBlockIndex
  state.nextBlockIndex += 1
  state.openBlock = { index, type }
  if (type === 'text') {
    events.push(createGeminiEnvelope(update, { type: 'message.start', role: 'assistant' }, {
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

function extractPromptUsage(result: Record<string, unknown>): HammurabiUsage | undefined {
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

function createGeminiEnvelope(
  update: Record<string, unknown>,
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  const itemId = overrides.itemId
    ?? readTrimmedString(update.id)
    ?? readTrimmedString(update.toolCallId)
  const turnId = overrides.turnId
    ?? readTrimmedString(update.turnId)
    ?? readTrimmedString(update.sessionId)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'gemini',
      backend: 'acp',
      ...(readTrimmedString(update.sessionId) ? { sessionId: readTrimmedString(update.sessionId) } : {}),
      ...(sessionUpdate ? { rawEventType: sessionUpdate } : {}),
      ...(itemId ? { rawEventId: itemId } : {}),
    },
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    ev,
  }
}

function createGeminiRawEnvelope(update: Record<string, unknown>): TranscriptEnvelope {
  return createGeminiEnvelope(update, {
    type: 'provider.raw',
    method: readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type),
    payload: update,
  })
}

function createGeminiRawPayloadEnvelope(payload: unknown): TranscriptEnvelope {
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'gemini',
      backend: 'acp',
    },
    ev: {
      type: 'provider.raw',
      payload,
    },
  }
}

type GeminiTurnEndStatus = Extract<TranscriptEnvelopeEvent, { type: 'turn.end' }>['status']

interface SyntheticGeminiEnvelopeOptions {
  sessionId?: string
  itemId?: string
  clientSendId?: string
}

function createGeminiSyntheticEnvelope(
  rawEventType: string,
  ev: TranscriptEnvelopeEvent,
  options: SyntheticGeminiEnvelopeOptions = {},
): TranscriptEnvelope {
  return createGeminiEnvelope({
    sessionUpdate: rawEventType,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.itemId ? { id: options.itemId } : {}),
  }, ev, {
    ...(options.itemId ? { itemId: options.itemId } : {}),
    ...(options.clientSendId ? { clientSendId: options.clientSendId } : {}),
  })
}

export function createGeminiAssistantStartEnvelope(sessionId?: string): TranscriptEnvelope {
  const itemId = createTranscriptId()
  return createGeminiSyntheticEnvelope(
    'hammurabi/assistant-start',
    { type: 'message.start', role: 'assistant' },
    { sessionId, itemId },
  )
}

export function createGeminiProviderActivityEnvelope(
  title: string,
  data: unknown,
  sessionId?: string,
): TranscriptEnvelope {
  return createGeminiSyntheticEnvelope(
    'hammurabi/provider-activity',
    { type: 'provider.activity', title, data },
    { sessionId },
  )
}

export function createGeminiTurnEndEnvelope(
  status: GeminiTurnEndStatus,
  result: unknown,
  sessionId?: string,
): TranscriptEnvelope {
  return createGeminiSyntheticEnvelope(
    'hammurabi/turn-end',
    {
      type: 'turn.end',
      status,
      result,
      ...(status === 'error' || status === 'failed' ? { error: result } : {}),
    },
    { sessionId },
  )
}

export function createGeminiUserTranscriptEnvelopes(
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
    createGeminiSyntheticEnvelope('hammurabi/user', { type: 'message.start', role: 'user' }, envelopeOptions),
  ]
  if (visibleText) {
    events.push(createGeminiSyntheticEnvelope(
      'hammurabi/user',
      { type: 'message.delta', text: visibleText, channel: 'final' },
      envelopeOptions,
    ))
  }
  events.push(createGeminiSyntheticEnvelope('hammurabi/user', { type: 'message.end' }, envelopeOptions))
  return events
}

export function mapGeminiToTranscriptEnvelopes(
  rawUpdate: unknown,
  state: GeminiTurnState,
): TranscriptEnvelope[] {
  const update = asObject(rawUpdate)
  if (!update) {
    return [createGeminiRawPayloadEnvelope(rawUpdate)]
  }

  const sessionUpdate = readTrimmedString(update.sessionUpdate)
  if (!sessionUpdate) {
    return [createGeminiRawEnvelope(update)]
  }

  if (sessionUpdate === 'tool_call_update') {
    const status = readTrimmedString(update.status)
    if (status && status !== 'completed' && status !== 'failed') {
      const toolCallId = readTrimmedString(update.toolCallId) ?? createTranscriptId()
      return [createGeminiEnvelope(update, {
        type: 'tool.delta',
        toolCallId,
        status,
        output: extractToolOutput(update.content) ?? stringifyUnknown(update.rawOutput),
        data: update,
      }, { itemId: toolCallId })]
    }
  }

  const mapped = mapGeminiSessionUpdate(update, state)
  if (mapped.length > 0) {
    return mapped
  }

  if (sessionUpdate.includes('sessionUpdate') || sessionUpdate.includes('status') || sessionUpdate.includes('error')) {
    return [createGeminiEnvelope(update, {
      type: 'provider.activity',
      title: sessionUpdate,
      data: update,
    })]
  }

  return [createGeminiRawEnvelope(update)]
}

export function mapGeminiPromptResponseToTranscriptEnvelopes(
  rawResult: unknown,
  state: GeminiTurnState,
): TranscriptEnvelope[] {
  const result = asObject(rawResult) ?? {}
  const stopReason = readTrimmedString(result.stopReason)
  const usage = extractPromptUsage(result)
  const finalResult = describeStopReason(stopReason)
  return [
    ...closeOpenBlock(state, result),
    ...(usage
      ? [createGeminiEnvelope(result, {
          type: 'provider.activity',
          title: 'Usage updated',
          data: { usage },
        })]
      : []),
    createGeminiEnvelope(result, { type: 'message.end' }),
    createGeminiEnvelope(result, {
      type: 'turn.end',
      status: finalResult.status,
      result: finalResult.result,
      ...(finalResult.isError ? { error: finalResult.result } : {}),
      ...(usage ? { usage } : {}),
    }),
  ]
}

export function createGeminiTurnState(): GeminiTurnState {
  return {
    nextBlockIndex: 0,
    openBlock: null,
  }
}

function mapGeminiSessionUpdate(
  update: Record<string, unknown>,
  state: GeminiTurnState,
): TranscriptEnvelope[] {
  const sessionUpdate = readTrimmedString(update.sessionUpdate)
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
        createGeminiEnvelope(update, {
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
        createGeminiEnvelope(update, {
          type: 'thinking.delta',
          text: thinking,
        }, { itemId: blockItemId(state.openBlock?.index ?? 0) }),
      ]
    }
    case 'tool_call': {
      const toolCallId = readTrimmedString(update.toolCallId) ?? createTranscriptId()
      return [
        ...closeOpenBlock(state, update),
        createGeminiEnvelope(update, {
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
      return [createGeminiEnvelope(update, {
        type: 'tool.end',
        toolCallId,
        status: status === 'failed' ? 'error' : 'ok',
        result: content,
        ...(status === 'failed' ? { error: content } : {}),
      }, { itemId: toolCallId })]
    }
    case 'plan': {
      const plan = formatPlan(update)
      if (!plan || plan === state.lastPlanText) {
        return []
      }
      state.lastPlanText = plan
      return [createGeminiEnvelope(update, {
        type: 'plan.update',
        plan: { action: 'proposed', plan },
      })]
    }
    default:
      return []
  }
}
