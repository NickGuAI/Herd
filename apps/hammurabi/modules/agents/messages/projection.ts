import type { StreamJsonEvent } from '../types.js'
import { mapStreamEventsToMessages } from './history.js'
import type { MsgItem } from './model.js'

export interface SessionProjectionUsageDTO {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface SessionProjectionReplayCursorDTO {
  totalEvents: number
  returnedEvents: number
  more: boolean
}

export interface SessionProjectionDTO {
  schemaVersion: 1
  messages: MsgItem[]
  replayCursor: SessionProjectionReplayCursorDTO
  usage?: SessionProjectionUsageDTO
  queue?: Extract<StreamJsonEvent, { type: 'queue_update' }>['queue']
}

export function projectSessionReplay(input: {
  events: readonly StreamJsonEvent[]
  totalEvents: number
  more: boolean
  usage?: SessionProjectionUsageDTO
  queue?: Extract<StreamJsonEvent, { type: 'queue_update' }>['queue']
}): SessionProjectionDTO {
  return {
    schemaVersion: 1,
    messages: mapStreamEventsToMessages(input.events),
    replayCursor: {
      totalEvents: input.totalEvents,
      returnedEvents: input.events.length,
      more: input.more,
    },
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.queue ? { queue: input.queue } : {}),
  }
}
