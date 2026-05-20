// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionMessageList } from '../SessionMessageList'
import type { MsgItem } from '../session-messages'

const THINKING_TEXT = 'Reason through the three git repos and compare status output.'

describe('SessionMessageList thinking blocks', () => {
  it('renders replayed thinking content on mount and supports collapse/re-expand', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages: MsgItem[] = [
      {
        id: 'thinking-1',
        kind: 'thinking',
        text: THINKING_TEXT,
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer: () => undefined }))
    })

    const toggle = container.querySelector('button')
    if (!toggle) {
      throw new Error('expected thinking toggle button')
    }
    const chevron = toggle.querySelector('svg.lucide-chevron-right')
    if (!chevron) {
      throw new Error('expected thinking chevron icon')
    }

    expect(container.textContent).toContain(THINKING_TEXT)
    expect(chevron.getAttribute('class')).toContain('rotate-90')

    flushSync(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).not.toContain(THINKING_TEXT)
    expect(chevron.getAttribute('class')).not.toContain('rotate-90')

    flushSync(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain(THINKING_TEXT)
    expect(chevron.getAttribute('class')).toContain('rotate-90')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('SessionMessageList queued transcript turns', () => {
  it('renders a processed queued user turn exactly once from the message projection', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages: MsgItem[] = [
      {
        id: 'queued-user-1',
        kind: 'user',
        text: 'processed queued follow-up',
      },
      {
        id: 'agent-1',
        kind: 'agent',
        text: 'I received the follow-up.',
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer: () => undefined }))
    })

    expect(container.textContent?.match(/processed queued follow-up/g) ?? []).toHaveLength(1)

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('SessionMessageList planning blocks', () => {
  it('renders enter, proposed, and decision planning messages with collapsible plan text', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages: MsgItem[] = [
      {
        id: 'planning-enter',
        kind: 'planning',
        text: '',
        planningAction: 'enter',
      },
      {
        id: 'planning-proposed',
        kind: 'planning',
        text: '',
        planningAction: 'proposed',
        planningPlan: '1. Capture the event\n2. Render the plan',
      },
      {
        id: 'planning-decision',
        kind: 'planning',
        text: '',
        planningAction: 'decision',
        planningApproved: true,
        planningMessage: 'Looks good. Continue.',
      },
      {
        id: 'ask-1',
        kind: 'ask',
        text: '',
        toolId: 'ask-tool-1',
        toolName: 'AskUserQuestion',
        askQuestions: [
          {
            question: 'Keep ask rendering?',
            header: 'Plan',
            options: [{ label: 'Yes', description: 'Keep it visible' }],
            multiSelect: false,
          },
        ],
        askAnswered: false,
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer: () => undefined }))
    })

    expect(container.textContent).toContain('Agent entered plan mode')
    expect(container.textContent).toContain('Proposed Plan')
    expect(container.textContent).toContain('Capture the event')
    expect(container.textContent).toContain('Approved')
    expect(container.textContent).toContain('Looks good. Continue.')
    expect(container.textContent).toContain('Keep ask rendering?')

    const buttons = Array.from(container.querySelectorAll('button'))
    const proposedToggle = buttons.find((button) => button.textContent?.includes('Proposed Plan'))
    if (!proposedToggle) {
      throw new Error('expected proposed plan toggle button')
    }

    flushSync(() => {
      proposedToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('Capture the event')

    flushSync(() => {
      proposedToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('Capture the event')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders plan approval asks and submits provider decisions', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onAnswer = vi.fn()

    const messages: MsgItem[] = [
      {
        id: 'plan-approval',
        kind: 'ask',
        text: '',
        toolId: 'plan-exit',
        toolName: 'ExitPlanMode',
        askInteractionKind: 'plan_approval',
        askAnswered: false,
        planApprovalPlan: '1. Inspect stream handling\n2. Patch replay',
        planApprovalApproveLabel: 'Approve',
        planApprovalRejectLabel: 'Reject',
        planApprovalCustomResponseLabel: 'Add response',
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer }))
    })

    expect(container.textContent).toContain('Plan Approval')
    expect(container.textContent).toContain('Inspect stream handling')

    const textarea = container.querySelector('textarea')
    if (!textarea) {
      throw new Error('expected plan response textarea')
    }
    const textareaValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set
    flushSync(() => {
      textareaValueSetter?.call(textarea, 'Ship this plan.')
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    const approveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Approve'))
    if (!approveButton) {
      throw new Error('expected approve button')
    }
    flushSync(() => {
      approveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onAnswer).toHaveBeenCalledWith('plan-exit', {
      decision: ['approve'],
      message: ['Ship this plan.'],
    })

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})
