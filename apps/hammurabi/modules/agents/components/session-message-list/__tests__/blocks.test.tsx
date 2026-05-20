// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentMessage,
  SubagentBlock,
  SystemDivider,
  ThinkingBlock,
  ToolBlock,
  ToolCallGroup,
  UserMessage,
} from '../blocks'
import { createUserMessage } from '../../../messages/model'

describe('UserMessage markdown rendering', () => {
  it('keeps bold chat markdown readable through Sumi-e semantic token classes', () => {
    const container = document.createElement('div')
    container.className = 'hv-dark hervald-chat-pane'
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement('div', undefined, [
          createElement(SystemDivider, { key: 'divider', text: 'session resumed' }),
          createElement(UserMessage, { key: 'user', text: '**Bold user text** with `inline code`.' }),
          createElement(AgentMessage, { key: 'agent', text: '**Bold agent text** with `inline code`.' }),
        ]),
      )
    })

    const userBubble = container.querySelector<HTMLElement>('.msg-user')
    const agentBubble = container.querySelector<HTMLElement>('.msg-agent')
    const dividerLine = container.querySelector<HTMLElement>('.msg-system-line')
    if (!userBubble || !agentBubble || !dividerLine) {
      throw new Error('expected chat token surfaces')
    }

    expect(userBubble.className).toContain('bg-[var(--hv-chat-user-bg,var(--hv-fg))]')
    expect(userBubble.className).toContain('text-[color:var(--hv-chat-user-fg,var(--hv-fg-inverse))]')
    expect(agentBubble.querySelector('strong')?.textContent).toBe('Bold agent text')
    expect(userBubble.querySelector('strong')?.textContent).toBe('Bold user text')
    expect(dividerLine.className).toContain('bg-[var(--hv-border-hair)]')

    const html = container.innerHTML
    expect(html).not.toContain('text-white')
    expect(html).not.toContain('bg-white')
    expect(html).not.toContain('text-sumi')
    expect(html).not.toContain('bg-washi')
    expect(html).not.toContain('border-ink')
    expect(html).not.toContain('text-amber')
    expect(html).not.toContain('text-violet')
    expect(html).not.toContain('text-red')
    expect(html).not.toContain('bg-red')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders headings, lists, inline code, and fenced code blocks via ReactMarkdown', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const markdown = [
      '# Heading',
      '',
      '- item',
      '',
      '`inline` and',
      '',
      '```',
      'code block',
      '```',
    ].join('\n')

    flushSync(() => {
      root.render(createElement(UserMessage, { text: markdown }))
    })

    const wrapper = container.querySelector('.msg-user-md')
    if (!wrapper) {
      throw new Error('expected .msg-user-md wrapper to be rendered')
    }

    // Heading
    expect(wrapper.querySelector('h1')?.textContent).toBe('Heading')

    // List
    const list = wrapper.querySelector('ul')
    if (!list) {
      throw new Error('expected <ul> rendered from markdown list')
    }
    expect(list.querySelector('li')?.textContent).toBe('item')

    // Inline code and fenced code block — both produce <code> elements; fenced
    // block is wrapped in a <pre>.
    const codeElements = wrapper.querySelectorAll('code')
    expect(codeElements.length).toBeGreaterThanOrEqual(2)
    const inlineCode = Array.from(codeElements).find(
      (element) => element.textContent === 'inline',
    )
    expect(inlineCode).toBeDefined()

    const pre = wrapper.querySelector('pre')
    if (!pre) {
      throw new Error('expected <pre> rendered from fenced code block')
    }
    expect(pre.querySelector('code')?.textContent).toContain('code block')

    // The raw markdown source with literal backticks and hashes must not leak
    // into the DOM as visible text.
    expect(wrapper.textContent).not.toContain('# Heading')
    expect(wrapper.textContent).not.toContain('`inline`')
    expect(wrapper.textContent).not.toContain('```')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('opens local file links through the workspace callback', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(UserMessage, {
        text: '[Open file](/home/builder/App/apps/hammurabi/README.md)',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('/home/builder/App/apps/hammurabi/README.md')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('strips source line suffixes from markdown file links before opening workspace files', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(UserMessage, {
        text: '[Open row](/home/builder/App/apps/hammurabi/modules/command-room/components/desktop/SessionRow.tsx:72)',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
      '/home/builder/App/apps/hammurabi/modules/command-room/components/desktop/SessionRow.tsx',
    )

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('opens backticked tilde file paths in agent messages through the workspace callback', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: 'Updated `~/App/agent-skills/general-skills/write-visual-email/SKILL.md`.',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('~/App/agent-skills/general-skills/write-visual-email/SKILL.md')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('strips source line and column suffixes from backticked tilde file paths', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: 'Updated `~/App/agent-skills/general-skills/write-visual-email/SKILL.md:12:4`.',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('~/App/agent-skills/general-skills/write-visual-email/SKILL.md')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('session message status blocks', () => {
  it('renders Agent tool calls as full sub-agent blocks with nested activity', () => {
    const container = document.createElement('div')
    container.className = 'hv-dark hervald-chat-pane'
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement(SubagentBlock, {
          msg: {
            id: 'agent-tool-1',
            kind: 'tool',
            text: '',
            toolName: 'Agent',
            toolStatus: 'running',
            subagentDescription: 'Investigate flaky chat rendering',
            children: [
              {
                id: 'agent-child-1',
                kind: 'system',
                text: 'Read SessionMessageList',
              },
            ],
          },
          onAnswer: () => undefined,
        }),
      )
    })

    const block = container.querySelector<HTMLElement>('.msg-subagent')
    if (!block) {
      throw new Error('expected sub-agent block')
    }

    expect(block.textContent).toContain('Sub-agent')
    expect(block.textContent).toContain('Investigate flaky chat rendering')
    expect(block.textContent).toContain('running')
    expect(block.textContent).toContain('activity')
    expect(block.textContent).toContain('Read SessionMessageList')
    expect(block.textContent).not.toContain('Agent: Investigate flaky chat rendering')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('uses Sumi-e semantic tokens for thinking and tool statuses', () => {
    const container = document.createElement('div')
    container.className = 'hv-dark hervald-chat-pane'
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement('div', undefined, [
          createElement(ThinkingBlock, { key: 'thinking', text: 'Inspecting contrast.' }),
          createElement(ToolBlock, {
            key: 'tool',
            msg: {
              id: 'tool-1',
              kind: 'tool',
              text: 'Edit file',
              toolName: 'Edit',
              toolStatus: 'error',
              oldString: 'old',
              newString: 'new',
            },
            onAnswer: () => undefined,
          }),
          createElement(ToolCallGroup, {
            key: 'group',
            tools: [
              {
                id: 'tool-2',
                kind: 'tool',
                text: 'Read file',
                toolName: 'Read',
                toolStatus: 'running',
              },
            ],
            onAnswer: () => undefined,
          }),
        ]),
      )
    })

    const toolHeader = container.querySelector<HTMLButtonElement>('.msg-tool-header')
    if (!toolHeader) {
      throw new Error('expected tool header')
    }
    flushSync(() => {
      toolHeader.click()
    })

    const html = container.innerHTML
    expect(html).toContain('text-[color:var(--hv-fg-muted)]')
    expect(html).toContain('text-[color:var(--hv-accent-warning)]')
    expect(html).toContain('text-[color:var(--hv-accent-danger)]')
    expect(html).toContain('bg-[var(--hv-accent-danger-wash)]')
    expect(html).not.toContain('text-amber')
    expect(html).not.toContain('text-violet')
    expect(html).not.toContain('text-red')
    expect(html).not.toContain('bg-red')
    expect(html).not.toContain('border-violet')
    expect(html).not.toContain('border-amber')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('createUserMessage text fidelity', () => {
  it('passes backticks through unchanged (no double-escape)', () => {
    const raw = 'hello `code`'
    const msg = createUserMessage('user-1', raw)
    expect(msg.text).toBe(raw)
    expect(msg.text).toBe('hello `code`')
    expect(msg.text).not.toContain('\\`')
  })

  it('preserves ${VAR} and heredoc-style content verbatim', () => {
    const raw = '- Branch: `${BRANCH_NAME}`'
    const msg = createUserMessage('user-2', raw)
    expect(msg.text).toBe(raw)
    expect(msg.text).not.toContain('\\`')
    expect(msg.text).not.toContain('\\$')
  })
})
