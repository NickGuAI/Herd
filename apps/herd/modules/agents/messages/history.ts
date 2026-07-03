import type { StreamJsonEvent } from '../types.js'
import { isHiddenInternalUserEventSubtype } from '../user-event-subtypes.js'
import type { MsgItem } from './model.js'
import {
  createStreamProcessorState,
  processStreamEvent,
  type StreamEventProcessorContext,
} from './stream-event-machine.js'
import { stabilizeMessageIds } from './stable-message-id.js'

function normalizeProjectionEvent(
  event: StreamJsonEvent,
): StreamJsonEvent[] {
  if (event.type === 'user' && isHiddenInternalUserEventSubtype(event.subtype)) {
    return []
  }
  return [event]
}

export function mapStreamEventsToMessages(events: readonly StreamJsonEvent[]): MsgItem[] {
  let idCounter = 0
  let messages: MsgItem[] = []
  const state = createStreamProcessorState()

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
    for (const normalizedEvent of normalizeProjectionEvent(event)) {
      processStreamEvent(context, normalizedEvent, true)
    }
  }

  return stabilizeMessageIds(messages)
}
