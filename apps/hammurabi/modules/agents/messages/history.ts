import type { StreamJsonEvent } from '../types.js'
import type { MsgItem } from './model.js'
import {
  createStreamProcessorState,
  processStreamEvent,
  type StreamEventProcessorContext,
} from './stream-event-machine.js'

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
    processStreamEvent(context, event, true)
  }

  return messages
}
