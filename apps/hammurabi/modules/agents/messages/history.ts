import type { StreamJsonEvent } from '../types.js'
import { createClaudeTranscriptMapper } from '../event-normalizers/claude.js'
import {
  isTranscriptEnvelope,
  type TranscriptEnvelope,
} from '../../../src/types/transcript-envelope.js'
import { isHiddenInternalUserEventSubtype } from '../user-event-subtypes.js'
import type { MsgItem } from './model.js'
import {
  createStreamProcessorState,
  processStreamEvent,
  type StreamEventProcessorContext,
} from './stream-event-machine.js'
import { stabilizeMessageIds } from './stable-message-id.js'

const LEGACY_COMMANDER_STARTUP_PROMPT =
  'Commander runtime started. Acknowledge readiness and await instructions.'
const LEGACY_HEARTBEAT_MARKER = '[HEARTBEAT'
const LEGACY_DEFAULT_HEARTBEAT_MARKER = 'Check your task list'
const LEGACY_CLAUDE_REASONING_POLICY_MARKER = '## Claude Code Reasoning Policy'
const LEGACY_COMMANDER_PROMPT_MARKER = 'You are Commander, the orchestration agent'

function readTextParts(content: unknown): string[] {
  if (typeof content === 'string') {
    return [content]
  }
  if (!Array.isArray(content)) {
    return []
  }
  return content.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry]
    }
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const text = (entry as { text?: unknown }).text
    return typeof text === 'string' ? [text] : []
  })
}

function readUserEventText(event: StreamJsonEvent): string {
  const message = (event as { message?: { content?: unknown } }).message
  return readTextParts(message?.content).join('\n').trim()
}

function isLegacyInternalUserPromptText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  if (trimmed === LEGACY_COMMANDER_STARTUP_PROMPT) {
    return true
  }
  if (
    trimmed.includes(LEGACY_HEARTBEAT_MARKER) &&
    (
      trimmed.includes(LEGACY_DEFAULT_HEARTBEAT_MARKER) ||
      trimmed.includes(LEGACY_CLAUDE_REASONING_POLICY_MARKER) ||
      trimmed.includes(LEGACY_COMMANDER_PROMPT_MARKER)
    )
  ) {
    return true
  }
  return trimmed.includes(LEGACY_CLAUDE_REASONING_POLICY_MARKER)
    && trimmed.includes(LEGACY_COMMANDER_PROMPT_MARKER)
}

function isLegacyInternalUserEvent(event: StreamJsonEvent): boolean {
  return event.type === 'user' && isLegacyInternalUserPromptText(readUserEventText(event))
}

function isLegacyInternalUserEnvelope(envelope: TranscriptEnvelope): boolean {
  if (
    envelope.source.provider !== 'claude' ||
    envelope.source.rawEventType !== 'hammurabi/user' ||
    envelope.ev.type !== 'message.delta'
  ) {
    return false
  }
  return isLegacyInternalUserPromptText(envelope.ev.text)
}

function normalizeProjectionEvent(
  event: StreamJsonEvent,
  claudeMapper: ReturnType<typeof createClaudeTranscriptMapper>,
): StreamJsonEvent[] {
  if (
    event.type === 'user' &&
    (
      isHiddenInternalUserEventSubtype(event.subtype) ||
      isLegacyInternalUserEvent(event)
    )
  ) {
    return []
  }
  if (isTranscriptEnvelope(event)) {
    if (isLegacyInternalUserEnvelope(event)) {
      return []
    }
    return [event]
  }
  if (event.source?.provider !== 'claude') {
    return [event]
  }
  return claudeMapper.map(event)
}

export function mapStreamEventsToMessages(events: readonly StreamJsonEvent[]): MsgItem[] {
  let idCounter = 0
  let messages: MsgItem[] = []
  const state = createStreamProcessorState()
  const claudeMapper = createClaudeTranscriptMapper()

  const context: StreamEventProcessorContext = {
    state,
    nextId: () => `msg-${++idCounter}`,
    setMessages: (updater) => {
      messages = updater(messages)
    },
    setIsStreaming: () => {},
    // Server-side paged history must not clip; the client renderer applies UI bounds separately.
    capMessages: (msgs) => msgs,
  }

  for (const event of events) {
    for (const normalizedEvent of normalizeProjectionEvent(event, claudeMapper)) {
      processStreamEvent(context, normalizedEvent, true)
    }
  }

  return stabilizeMessageIds(messages)
}
