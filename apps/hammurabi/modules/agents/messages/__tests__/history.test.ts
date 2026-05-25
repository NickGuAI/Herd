import { describe, expect, it } from 'vitest'
import { normalizeCodexEvent } from '../../event-normalizers/codex'
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

  it('renders Claude signed empty thinking through the backend projection contract', () => {
    const signature = 'A'.repeat(464)

    const messages = mapStreamEventsToMessages([{
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'claude-thinking',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature }],
      },
    }])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
      }),
    ])
  })

  it('projects user display text without leaking provider-bound workspace context', () => {
    const messages = mapStreamEventsToMessages([{
      type: 'user',
      subtype: 'queued_message',
      displayText: 'Use this context.',
      message: {
        role: 'user',
        content: '<workspace-files>\n@README.md\n</workspace-files>\nUse this context.',
      },
    } as StreamJsonEvent])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Use this context.',
      }),
    ])
    expect(messages[0]?.text).not.toContain('<workspace-')
  })

  it('merges Codex completed reasoning into the active thinking row', () => {
    const started = normalizeCodexEvent('item/started', {
      item: { id: 'reasoning-1', type: 'reasoning' },
    })
    const completed = normalizeCodexEvent('item/completed', {
      item: {
        id: 'reasoning-1',
        type: 'reasoning',
        summary: ['Final completed reasoning'],
      },
    })

    const messages = mapStreamEventsToMessages([
      started as StreamJsonEvent,
      completed as StreamJsonEvent,
    ])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: 'Final completed reasoning',
      }),
    ])
  })

  it('renders Gemini and OpenCode canonical stream events without provider branching', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'content_block_start',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
        delta: { type: 'text_delta', text: 'Gemini says hi' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
      },
      {
        type: 'content_block_start',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
        content_block: { type: 'thinking' },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
        delta: { type: 'thinking_delta', thinking: 'OpenCode thought' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'agent', text: 'Gemini says hi' }),
      expect.objectContaining({ kind: 'thinking', text: 'OpenCode thought' }),
    ])
  })

  it('keeps unknown-provider thinking fallback safe and text-only', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'assistant',
        source: { provider: 'test-provider', backend: 'cli' },
        message: {
          id: 'unknown-thinking',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'visible fallback' },
            { type: 'thinking', thinking: '' },
          ],
        },
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'thinking', text: 'visible fallback' }),
    ])
  })
})
