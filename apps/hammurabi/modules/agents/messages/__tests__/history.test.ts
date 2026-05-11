import { describe, expect, it } from 'vitest'
import type { StreamJsonEvent } from '../../types'
import { mapStreamEventsToMessages } from '../history'
import { MAX_CLIENT_MESSAGES } from '../model'

function assistantTextEvent(index: number): StreamJsonEvent {
  return {
    type: 'assistant',
    message: {
      id: `message-${index}`,
      role: 'assistant',
      content: [{ type: 'text', text: `message ${index}` }],
    },
  }
}

describe('mapStreamEventsToMessages', () => {
  it('preserves server-side replay history beyond the client render cap', () => {
    const messageCount = MAX_CLIENT_MESSAGES + 25

    const messages = mapStreamEventsToMessages(
      Array.from({ length: messageCount }, (_, index) => assistantTextEvent(index)),
    )

    expect(messages).toHaveLength(messageCount)
    expect(messages[0]).toMatchObject({ kind: 'agent', text: 'message 0' })
    expect(messages[messageCount - 1]).toMatchObject({
      kind: 'agent',
      text: `message ${messageCount - 1}`,
    })
  })
})
