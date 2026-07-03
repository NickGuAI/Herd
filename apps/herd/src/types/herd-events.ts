export type HerdEventProvider = string

export type HerdEventBackend = 'cli' | 'stream-json' | 'acp' | 'rpc'

export interface HerdEventSource {
  provider: HerdEventProvider
  backend: HerdEventBackend
  normalizedAt?: string
  schemaVersion?: string
}

export interface HerdUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface HerdToolUseBlock {
  type: 'tool_use'
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export interface HerdToolResultBlock {
  type: 'tool_result'
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export interface HerdTextBlock {
  type: 'text'
  text?: string
}

export interface HerdThinkingBlock {
  type: 'thinking'
  thinking?: string
  text?: string
  signature?: string
  presentation?: {
    mergeWithActiveThinking?: boolean
  }
}

export interface HerdImageBlock {
  type: 'image'
  alt?: string
  url?: string
  path?: string
  source?: {
    type?: string
    media_type?: string
    mediaType?: string
    data?: string
    url?: string
    path?: string
  }
}

export type HerdAssistantContentBlock =
  | HerdTextBlock
  | HerdThinkingBlock
  | HerdToolUseBlock
  | HerdImageBlock

export type HerdUserContentBlock =
  | HerdToolResultBlock
  | HerdTextBlock
  | HerdImageBlock

interface HerdEventBase {
  source?: HerdEventSource
  [key: string]: unknown
}

export interface PlanningStreamEvent extends HerdEventBase {
  type: 'planning'
  action: 'enter' | 'proposed' | 'decision'
  toolId?: string
  plan?: string
  approved?: boolean | null
  message?: string
}

export type PlanApprovalDecision = 'approve' | 'reject'

export interface PlanApprovalProviderContext {
  provider: HerdEventProvider
  backend: HerdEventBackend
  toolUseId: string
  toolName: string
  requestId?: string | number
  answerFormat: 'claude.exit_plan_mode' | 'opencode.plan_decision'
  requestedSchema?: unknown
}

export interface PlanApprovalStreamEvent extends HerdEventBase {
  type: 'plan_approval'
  interactionKind: 'plan_approval'
  toolId: string
  toolName: string
  plan: string
  approveLabel?: string
  rejectLabel?: string
  customResponseLabel?: string
  expiresAt?: string
  autoResolveAfterMs?: number
  defaultDecision?: PlanApprovalDecision
  providerContext: PlanApprovalProviderContext
}

export interface QueueEventMessage {
  id: string
  text: string
  displayText?: string
  priority: 'high' | 'normal' | 'low'
  queuedAt: string
}

export type HerdEvent =
  | (PlanningStreamEvent & HerdEventBase)
  | (PlanApprovalStreamEvent & HerdEventBase)
  | ({
      type: 'queue_update'
      queue: {
        items: QueueEventMessage[]
        currentMessage?: QueueEventMessage | null
        maxSize?: number
        totalCount?: number
      }
    } & HerdEventBase)
  | ({
      type: 'content_block_start'
      index?: number
      content_block: HerdTextBlock | HerdThinkingBlock | HerdToolUseBlock | HerdImageBlock
    } & HerdEventBase)
  | ({
      type: 'content_block_delta'
      index?: number
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'input_json_delta'; partial_json: string }
    } & HerdEventBase)
  | ({
      type: 'content_block_stop'
      index?: number
    } & HerdEventBase)
  | ({
      type: 'message_delta'
      delta?: { stop_reason?: string }
      usage?: HerdUsage
      usage_is_total?: boolean
      cost_usd?: number
      total_cost_usd?: number
    } & HerdEventBase)
  | ({
      type: 'message_stop'
    } & HerdEventBase)
  | ({
      type: 'assistant'
      message: {
        id: string
        role: 'assistant'
        content: HerdAssistantContentBlock[]
        usage?: HerdUsage
      }
    } & HerdEventBase)
  | ({
      type: 'user'
      message: {
        role: 'user'
        content: string | HerdUserContentBlock[]
      }
      tool_use_result?: {
        stdout?: string
        stderr?: string
        interrupted?: boolean
        isImage?: boolean
        noOutputExpected?: boolean
      }
    } & HerdEventBase)
  | ({
      type: 'exit'
      exitCode: number
      signal?: string | number
    } & HerdEventBase)
  | ({
      type: 'system'
      text?: string
      subtype?: string
      description?: string
      last_tool_name?: string
    } & HerdEventBase)
  | ({
      type: 'agent'
      message?: unknown
      text?: unknown
    } & HerdEventBase)
  | ({
      type: 'rate_limit_event'
    } & HerdEventBase)
  | ({
      type: 'tool_use'
      id?: string
      name?: string
      input?: Record<string, unknown>
    } & HerdEventBase)
  | ({
      type: 'tool_result'
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    } & HerdEventBase)
