import type { TranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import { extractProviderLimitDetails } from '../provider-errors.js'
import { createTranscriptId } from '../transcript-id.js'

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  return value as Record<string, unknown>
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return undefined
}

function extractUsageUpdate(params: Record<string, unknown>): {
  usage: { input_tokens?: number; output_tokens?: number }
  totalCostUsd?: number
} | null {
  const usagePayload = asObject(params.tokenUsage) ?? asObject(params.usage) ?? params
  if (!usagePayload) {
    return null
  }

  const inputTokens = readNumber(usagePayload, ['input_tokens', 'inputTokens', 'input'])
  const outputTokens = readNumber(usagePayload, ['output_tokens', 'outputTokens', 'output'])
  const totalCostUsd = readNumber(usagePayload, ['total_cost_usd', 'totalCostUsd', 'cost_usd', 'costUsd'])

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalCostUsd === undefined
  ) {
    return null
  }

  return {
    usage: {
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    },
    totalCostUsd,
  }
}

function extractReasoningTextChunk(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null

  const chunk = value as Record<string, unknown>
  return typeof chunk.text === 'string' ? chunk.text : null
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

type CodexRateLimitStatus = {
  primaryUsedPercent?: number
  secondaryUsedPercent?: number
  primaryResetAtIso?: string
  rateLimitReachedType?: string
  planType?: string
}

const CODEX_RATE_LIMIT_SURFACE_THRESHOLD_PERCENT = 90

function formatCodexTimestamp(value: unknown): string | undefined {
  const numericValue = typeof value === 'number' && Number.isFinite(value)
    ? value
    : (typeof value === 'string' && value.trim().length > 0 ? Number(value) : undefined)
  if (typeof numericValue === 'number' && Number.isFinite(numericValue)) {
    const millis = numericValue > 10_000_000_000 ? numericValue : numericValue * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  const textValue = readTrimmedString(value)
  if (!textValue) {
    return undefined
  }
  const date = new Date(textValue)
  return Number.isNaN(date.getTime()) ? textValue : date.toISOString()
}

function extractCodexRateLimitStatus(params: Record<string, unknown>): CodexRateLimitStatus | null {
  const rateLimits = asObject(params.rateLimits) ?? params
  const primary = asObject(rateLimits.primary)
  const secondary = asObject(rateLimits.secondary)
  const primaryUsedPercent = primary
    ? readNumber(primary, ['usedPercent', 'used_percent'])
    : readNumber(rateLimits, ['primaryUsedPercent', 'primary_used_percent', 'usedPercent', 'used_percent'])
  const secondaryUsedPercent = secondary
    ? readNumber(secondary, ['usedPercent', 'used_percent'])
    : readNumber(rateLimits, ['secondaryUsedPercent', 'secondary_used_percent'])
  const primaryResetAtIso = formatCodexTimestamp(
    primary?.resetsAt
    ?? primary?.resetAt
    ?? rateLimits.primaryResetsAt
    ?? rateLimits.primaryResetAt
    ?? rateLimits.resetsAt
    ?? rateLimits.resetAt,
  )
  const rateLimitReachedType = readTrimmedString(rateLimits.rateLimitReachedType)
    ?? readTrimmedString(params.rateLimitReachedType)
  const planType = readTrimmedString(rateLimits.planType)
    ?? readTrimmedString(params.planType)

  if (
    primaryUsedPercent === undefined
    && secondaryUsedPercent === undefined
    && !primaryResetAtIso
    && !rateLimitReachedType
    && !planType
  ) {
    return null
  }

  return {
    ...(primaryUsedPercent !== undefined ? { primaryUsedPercent } : {}),
    ...(secondaryUsedPercent !== undefined ? { secondaryUsedPercent } : {}),
    ...(primaryResetAtIso ? { primaryResetAtIso } : {}),
    ...(rateLimitReachedType ? { rateLimitReachedType } : {}),
    ...(planType ? { planType } : {}),
  }
}

function shouldSurfaceCodexRateLimitStatus(status: CodexRateLimitStatus): boolean {
  return Boolean(status.rateLimitReachedType)
    || (status.primaryUsedPercent ?? 0) >= CODEX_RATE_LIMIT_SURFACE_THRESHOLD_PERCENT
    || (status.secondaryUsedPercent ?? 0) >= CODEX_RATE_LIMIT_SURFACE_THRESHOLD_PERCENT
}

function formatCodexRateLimitDetail(status: CodexRateLimitStatus): string {
  const parts: string[] = []
  if (status.primaryUsedPercent !== undefined) {
    parts.push(`primary quota ${Math.round(status.primaryUsedPercent)}% used`)
  }
  if (status.secondaryUsedPercent !== undefined) {
    parts.push(`weekly quota ${Math.round(status.secondaryUsedPercent)}% used`)
  }
  if (status.primaryResetAtIso) {
    parts.push(`resets at ${status.primaryResetAtIso}`)
  }
  if (status.rateLimitReachedType) {
    parts.push(`limit status ${status.rateLimitReachedType}`)
  }
  if (status.planType) {
    parts.push(`plan ${status.planType}`)
  }
  return parts.length > 0 ? `Codex ${parts.join('; ')}.` : 'Codex quota status changed.'
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readCodeString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return readTrimmedString(value)
}

function readCodexContentText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined
  }
  if (!Array.isArray(value)) {
    const record = asObject(value)
    return readNonEmptyString(record?.text)
      ?? readNonEmptyString(record?.content)
      ?? undefined
  }

  const chunks = value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return entry.length > 0 ? [entry] : []
    }
    const record = asObject(entry)
    const text = readNonEmptyString(record?.text)
      ?? readNonEmptyString(record?.content)
    return text ? [text] : []
  })
  return chunks.length > 0 ? chunks.join('') : undefined
}

function readCodexMessageDeltaText(params: Record<string, unknown>): string | undefined {
  return readNonEmptyString(params.text)
    ?? readNonEmptyString(params.delta)
    ?? readNonEmptyString(params.textDelta)
    ?? readNonEmptyString(params.outputTextDelta)
    ?? extractReasoningTextChunk(params.delta)
    ?? undefined
}

function readIdString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return readTrimmedString(value)
}

function readCodexThreadId(params: Record<string, unknown>, item?: Record<string, unknown> | null): string | undefined {
  return readTrimmedString(params.threadId)
    ?? readTrimmedString(asObject(params.turn)?.threadId)
    ?? readTrimmedString(item?.threadId)
    ?? readTrimmedString(asObject(params.thread)?.id)
}

function readCodexTurnId(params: Record<string, unknown>, item?: Record<string, unknown> | null): string | undefined {
  return readTrimmedString(params.turnId)
    ?? readTrimmedString(asObject(params.turn)?.id)
    ?? readTrimmedString(item?.turnId)
}

function readCodexItemId(params: Record<string, unknown>, item?: Record<string, unknown> | null): string | undefined {
  return readTrimmedString(params.itemId)
    ?? readTrimmedString(item?.id)
    ?? readIdString(params.requestId)
}

function readCodexParentId(item: Record<string, unknown> | null): string | undefined {
  return readTrimmedString(item?.parentId)
    ?? readTrimmedString(asObject(item?.parent)?.id)
}

function readCodexSubagentId(item: Record<string, unknown> | null, params: Record<string, unknown>): string | undefined {
  return readTrimmedString(item?.subagentId)
    ?? readTrimmedString(params.subagentId)
    ?? readTrimmedString(asObject(item?.subagent)?.id)
}

function readCodexAgentMessageText(item: Record<string, unknown>): string | undefined {
  return readNonEmptyString(item.text)
    ?? readNonEmptyString(item.outputText)
    ?? readNonEmptyString(item.output_text)
    ?? readNonEmptyString(item.message)
    ?? readCodexContentText(item.content)
    ?? undefined
}

function isCodexCollabAgentItemType(itemType: string | undefined): boolean {
  return itemType === 'collabToolCall' || itemType === 'collabAgentToolCall'
}

function codexToolName(item: Record<string, unknown>): string {
  const itemType = readTrimmedString(item.type)
  if (isCodexCollabAgentItemType(itemType)) {
    return 'Agent'
  }
  if (itemType === 'mcpToolCall') {
    const server = readTrimmedString(item.server)
    const tool = readTrimmedString(item.tool)
    if (server && tool) {
      return `mcp__${server}__${tool}`
    }
  }
  const explicit = readTrimmedString(item.name) ?? readTrimmedString(item.title)
  if (explicit) {
    return explicit
  }
  switch (itemType) {
    case 'commandExecution':
      return 'Bash'
    case 'fileChange':
      return 'Edit'
    case 'mcpToolCall':
      return 'MCP'
    case 'dynamicToolCall':
      return 'DynamicTool'
    case 'collabToolCall':
      return 'Agent'
    case 'webSearch':
      return 'WebSearch'
    case 'imageView':
      return 'ImageView'
    case 'contextCompaction':
    case 'compacted':
      return 'ContextCompaction'
    case 'reviewMode':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return 'ReviewMode'
    default:
      return itemType ?? 'Tool'
  }
}

function readCodexFileChangePath(item: Record<string, unknown>): string {
  const direct = readTrimmedString(item.filePath) ?? readTrimmedString(item.file) ?? readTrimmedString(item.path)
  if (direct) {
    return direct
  }
  const changes = Array.isArray(item.changes) ? item.changes : []
  for (const change of changes) {
    const path = readTrimmedString(asObject(change)?.path)
    if (path) {
      return path
    }
  }
  return ''
}

function codexToolInput(item: Record<string, unknown>): unknown {
  if (item.type === 'commandExecution') {
    return {
      command: readTrimmedString(item.command) ?? readTrimmedString(item.input) ?? '',
      cwd: readTrimmedString(item.cwd),
    }
  }
  if (item.type === 'fileChange') {
    return {
      file_path: readCodexFileChangePath(item),
      patch: item.patch ?? item.diff ?? item.changes,
      content: item.content,
    }
  }
  if (item.type === 'mcpToolCall') {
    return item.arguments ?? item.input ?? item.args ?? item
  }
  return asObject(item.input) ?? asObject(item.args) ?? item.input ?? item
}

function createCodexEnvelope(
  method: string,
  params: Record<string, unknown>,
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const item = asObject(params.item)
  const threadId = readCodexThreadId(params, item)
  const turnId = overrides.turnId ?? readCodexTurnId(params, item)
  const itemId = overrides.itemId ?? readCodexItemId(params, item)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'codex',
      backend: 'rpc',
      ...(threadId ? { sessionId: threadId } : {}),
      ...(method ? { rawEventType: method } : {}),
      ...(itemId ?? turnId ? { rawEventId: itemId ?? turnId } : {}),
    },
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(overrides.parentId ?? readCodexParentId(item) ? { parentId: overrides.parentId ?? readCodexParentId(item) } : {}),
    ...(overrides.subagentId ?? readCodexSubagentId(item, params)
      ? { subagentId: overrides.subagentId ?? readCodexSubagentId(item, params) }
      : {}),
    ev,
  }
}

function createCodexRawEnvelope(method: string, params: Record<string, unknown>): TranscriptEnvelope {
  return createCodexEnvelope(method, params, {
    type: 'provider.raw',
    method,
    payload: params,
  })
}

function createCodexActivityEnvelope(
  method: string,
  params: Record<string, unknown>,
  title: string,
  detail?: string,
  data?: unknown,
): TranscriptEnvelope {
  return createCodexEnvelope(method, params, {
    type: 'provider.activity',
    title,
    ...(detail ? { detail } : {}),
    ...(data !== undefined ? { data } : {}),
  })
}

function createCodexProviderErrorEnvelope(
  method: string,
  params: Record<string, unknown>,
): TranscriptEnvelope {
  const error = asObject(params.error)
  const message = readTrimmedString(error?.message)
    ?? readTrimmedString(params.message)
    ?? 'Codex provider error'
  const code = readCodeString(error?.codexErrorInfo)
    ?? readCodeString(error?.code)
    ?? readCodeString(params.code)
  const hint = readTrimmedString(error?.additionalDetails)
    ?? readTrimmedString(params.additionalDetails)
  const details = extractProviderLimitDetails(message, code)
  return createCodexEnvelope(method, params, {
    type: 'provider.error',
    message,
    classification: details.classification,
    ...(code ? { code } : {}),
    ...(hint ? { hint } : {}),
    ...(details.resetAt ? { resetAt: details.resetAt } : {}),
    retryable: details.classification === 'usage_limit' || params.willRetry === true,
    data: params,
  })
}

function createCodexRateLimitErrorEnvelope(
  method: string,
  params: Record<string, unknown>,
  rateLimit: CodexRateLimitStatus,
): TranscriptEnvelope {
  const message = 'Codex quota limit reached'
  const code = rateLimit.rateLimitReachedType ?? 'rate_limit'
  const details = extractProviderLimitDetails(message, code, {
    resetAt: rateLimit.primaryResetAtIso,
  })
  return createCodexEnvelope(method, params, {
    type: 'provider.error',
    message,
    classification: 'usage_limit',
    code,
    ...(details.resetAt ? { resetAt: details.resetAt } : {}),
    retryable: true,
    data: { rateLimit },
  })
}

function mapCodexStartedItem(method: string, params: Record<string, unknown>): TranscriptEnvelope[] {
  const item = asObject(params.item)
  if (!item) {
    return [createCodexRawEnvelope(method, params)]
  }
  const itemType = readTrimmedString(item.type)
  if (!itemType) {
    return []
  }
  if (itemType === 'userMessage') {
    return []
  }
  if (itemType === 'agentMessage') {
    return [createCodexEnvelope(method, params, { type: 'message.start', role: 'assistant' })]
  }
  if (itemType === 'reasoning') {
    return [createCodexActivityEnvelope(method, params, 'Reasoning started', itemType, item)]
  }
  if (itemType === 'plan') {
    return [createCodexActivityEnvelope(method, params, 'Plan item started', itemType, item)]
  }
  if (itemType === 'enteredReviewMode') {
    return [createCodexActivityEnvelope(method, params, 'Review mode entered', itemType, item)]
  }
  if (itemType === 'exitedReviewMode') {
    return [createCodexActivityEnvelope(method, params, 'Review mode exited', itemType, item)]
  }
  if (itemType === 'contextCompaction' || itemType === 'compacted') {
    return [createCodexActivityEnvelope(method, params, 'Context compaction started', itemType, item)]
  }
  return [createCodexEnvelope(method, params, {
    type: 'tool.start',
    toolCallId: readTrimmedString(item.id) ?? createTranscriptId(),
    name: codexToolName(item),
    input: codexToolInput(item),
    title: readTrimmedString(item.title),
  })]
}

function mapCodexCompletedItem(method: string, params: Record<string, unknown>): TranscriptEnvelope[] {
  const item = asObject(params.item)
  if (!item) {
    return [createCodexRawEnvelope(method, params)]
  }
  const itemType = readTrimmedString(item.type)
  const itemId = readTrimmedString(item.id) ?? createTranscriptId()
  switch (itemType) {
    case 'userMessage':
      return []
    case 'agentMessage': {
      const text = readCodexAgentMessageText(item)
      return text
        ? [
            createCodexEnvelope(method, params, { type: 'message.start', role: 'assistant' }, { itemId }),
            createCodexEnvelope(method, params, { type: 'message.delta', text, channel: 'final' }, { itemId }),
            createCodexEnvelope(method, params, { type: 'message.end' }, { itemId }),
          ]
        : [createCodexEnvelope(method, params, { type: 'message.end' }, { itemId })]
    }
    case 'reasoning':
      return [createCodexActivityEnvelope(method, params, 'Reasoning completed', itemType, item)]
    case 'plan': {
      const plan = readTrimmedString(item.text) ?? readTrimmedString(item.plan) ?? item
      return [createCodexEnvelope(method, params, { type: 'plan.update', plan }, { itemId })]
    }
    case 'fileChange':
      return [
        createCodexEnvelope(method, params, {
          type: 'file.change',
          path: readCodexFileChangePath(item),
          action: 'applied',
          data: item,
        }, { itemId }),
        createCodexEnvelope(method, params, {
          type: 'tool.end',
          toolCallId: itemId,
          status: typeof item.error === 'string' || item.failed === true ? 'error' : 'ok',
          result: item,
        }, { itemId }),
      ]
    case 'commandExecution':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabToolCall':
    case 'collabAgentToolCall':
    case 'webSearch':
    case 'imageView':
    case 'contextCompaction':
    case 'compacted':
    case 'reviewMode':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return [createCodexEnvelope(method, params, {
        type: 'tool.end',
        toolCallId: itemId,
        status: typeof item.error === 'string' || item.failed === true ? 'error' : 'ok',
        result: item.output ?? item,
      }, { itemId })]
    default:
      return [createCodexActivityEnvelope(method, params, `${itemType ?? 'Item'} completed`, itemType, item)]
  }
}

export function mapCodexToTranscriptEnvelopes(
  method: string,
  params: unknown,
): TranscriptEnvelope[] {
  const p = asObject(params) ?? {}
  switch (method) {
    case 'account/rateLimits/updated': {
      const rateLimit = extractCodexRateLimitStatus(p)
      if (!rateLimit || !shouldSurfaceCodexRateLimitStatus(rateLimit)) {
        return []
      }
      const activity = createCodexActivityEnvelope(
        method,
        p,
        rateLimit.rateLimitReachedType ? 'Codex quota limit reached' : 'Codex quota nearly exhausted',
        formatCodexRateLimitDetail(rateLimit),
        { rateLimit, rateLimits: asObject(p.rateLimits) ?? p },
      )
      return rateLimit.rateLimitReachedType
        ? [activity, createCodexRateLimitErrorEnvelope(method, p, rateLimit)]
        : [activity]
    }
    case 'thread/started':
      return [createCodexActivityEnvelope(method, p, 'Thread started', undefined, p)]
    case 'thread/archived':
      return [createCodexActivityEnvelope(method, p, 'Thread archived', undefined, p)]
    case 'thread/unarchived':
      return [createCodexActivityEnvelope(method, p, 'Thread unarchived', undefined, p)]
    case 'thread/closed':
      return [createCodexActivityEnvelope(method, p, 'Thread closed', undefined, p)]
    case 'thread/status/changed':
      return [createCodexActivityEnvelope(method, p, 'Thread status changed', readTrimmedString(p.status), p)]
    case 'thread/tokenUsage/updated': {
      const usageUpdate = extractUsageUpdate(p)
      return usageUpdate
        ? [createCodexEnvelope(method, p, {
            type: 'provider.activity',
            title: 'Token usage updated',
            data: {
              usage: usageUpdate.usage,
              total_cost_usd: usageUpdate.totalCostUsd,
              usage_is_total: true,
            },
          })]
        : [createCodexRawEnvelope(method, p)]
    }
    case 'turn/started':
      return [
        createCodexEnvelope(method, p, { type: 'turn.start', role: 'assistant' }),
        createCodexEnvelope(method, p, { type: 'message.start', role: 'assistant' }),
      ]
    case 'turn/completed': {
      const turn = asObject(p.turn)
      const status = readTrimmedString(turn?.status) ?? 'completed'
      const usage = extractUsageUpdate(turn ?? p)?.usage
      return [
        createCodexEnvelope(method, p, { type: 'message.end' }),
        createCodexEnvelope(method, p, {
          type: 'turn.end',
          status,
          ...(usage ? { usage } : {}),
          ...(status === 'failed' ? { error: turn ?? p } : { result: turn ?? p }),
        }),
      ]
    }
    case 'turn/plan/updated':
      return [createCodexEnvelope(method, p, { type: 'plan.update', plan: p.plan ?? asObject(p.turn)?.plan ?? p })]
    case 'turn/diff/updated':
      return [createCodexActivityEnvelope(method, p, 'Turn diff updated', undefined, p)]
    case 'item/started':
      return mapCodexStartedItem(method, p)
    case 'item/agentMessage/delta': {
      const text = readCodexMessageDeltaText(p)
      return text
        ? [createCodexEnvelope(method, p, { type: 'message.delta', text, channel: 'final' })]
        : [createCodexRawEnvelope(method, p)]
    }
    case 'item/plan/delta': {
      const text = typeof p.text === 'string'
        ? p.text
        : extractReasoningTextChunk(p.delta)
      return text
        ? [createCodexEnvelope(method, p, { type: 'plan.update', plan: text })]
        : [createCodexRawEnvelope(method, p)]
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const text = extractReasoningTextChunk(p.delta)
      return text
        ? [createCodexEnvelope(method, p, { type: 'thinking.delta', text })]
        : [createCodexRawEnvelope(method, p)]
    }
    case 'item/reasoning/summaryPartAdded':
      return [createCodexActivityEnvelope(method, p, 'Reasoning summary part added', undefined, p)]
    case 'item/commandExecution/outputDelta': {
      const item = asObject(p.item)
      const toolCallId = readCodexItemId(p, item) ?? createTranscriptId()
      const output = readNonEmptyString(p.delta)
        ?? readNonEmptyString(p.outputDelta)
        ?? readNonEmptyString(asObject(p.output)?.text)
      return output
        ? [createCodexEnvelope(method, p, { type: 'tool.delta', toolCallId, output }, { itemId: toolCallId })]
        : [createCodexRawEnvelope(method, p)]
    }
    case 'item/fileChange/outputDelta': {
      const item = asObject(p.item)
      const toolCallId = readCodexItemId(p, item) ?? createTranscriptId()
      const output = readNonEmptyString(p.delta)
        ?? readNonEmptyString(p.outputDelta)
        ?? readNonEmptyString(p.patch)
        ?? readNonEmptyString(p.diff)
        ?? readNonEmptyString(asObject(p.output)?.text)
      return output
        ? [createCodexEnvelope(method, p, {
            type: 'tool.delta',
            toolCallId,
            output,
            patch: output,
          }, { itemId: toolCallId })]
        : [createCodexRawEnvelope(method, p)]
    }
    case 'item/completed':
      return mapCodexCompletedItem(method, p)
    case 'item/tool/requestUserInput': {
      const prompt = readTrimmedString(p.prompt)
        ?? readTrimmedString(asObject(p.item)?.prompt)
        ?? 'Codex requested user input'
      const item = asObject(p.item)
      const toolCallId = readCodexItemId(p, item) ?? createTranscriptId()
      const questions = Array.isArray(p.questions)
        ? p.questions
        : (Array.isArray(asObject(p.input)?.questions) ? asObject(p.input)?.questions : undefined)
      return [createCodexEnvelope(method, p, {
        type: 'approval.request',
        toolCallId,
        interactionKind: 'ask_user_question',
        prompt,
        request: p,
        ...(questions ? { questions } : {}),
      }, { itemId: toolCallId })]
    }
    case 'item/tool/call':
      return [createCodexActivityEnvelope(method, p, 'Codex dynamic tool call requested', undefined, p)]
    case 'serverRequest/resolved':
      return [createCodexActivityEnvelope(method, p, 'Server request resolved', undefined, p)]
    case 'fuzzyFileSearch/sessionUpdated':
      return [createCodexActivityEnvelope(method, p, 'Fuzzy file search updated', undefined, p)]
    case 'fuzzyFileSearch/sessionCompleted':
      return [createCodexActivityEnvelope(method, p, 'Fuzzy file search completed', undefined, p)]
    case 'windowsSandbox/setupCompleted':
      return [createCodexActivityEnvelope(method, p, 'Sandbox setup completed', undefined, p)]
    case 'error':
      {
        const activityEnvelope = createCodexActivityEnvelope(
          method,
          p,
          'Codex error',
          readTrimmedString(asObject(p.error)?.message) ?? readTrimmedString(p.message),
          p,
        )
        return p.willRetry === false
          ? [activityEnvelope, createCodexProviderErrorEnvelope(method, p)]
          : [activityEnvelope]
      }
    default:
      return [createCodexRawEnvelope(method, p)]
  }
}
