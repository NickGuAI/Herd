import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUBAGENT_WORKING_LABEL, type MsgItem } from '../../messages/model'
import { formatToolDisplayName, getToolMeta, isAgentAccentColor } from './tool-meta'

function normalizeWorkspaceFileHref(href?: string): string | null {
  const raw = href?.trim()
  if (!raw) {
    return null
  }
  if (/^https?:\/\//iu.test(raw) || raw.startsWith('#') || raw.startsWith('mailto:')) {
    return null
  }
  try {
    if (raw.startsWith('file://')) {
      return stripWorkspaceSourceLocationSuffix(decodeURIComponent(new URL(raw).pathname))
    }
  } catch {
    return null
  }
  if (
    raw.startsWith('/')
    || raw.startsWith('~/')
    || raw.startsWith('./')
    || raw.startsWith('../')
    || /^[A-Za-z]:[\\/]/u.test(raw)
  ) {
    return stripWorkspaceSourceLocationSuffix(decodeURIComponent(raw))
  }
  return null
}

function stripWorkspaceSourceLocationSuffix(filePath: string): string {
  const match = /^(.*?)(?::\d+)(?::\d+)?$/u.exec(filePath)
  const pathWithoutLocation = match?.[1]?.trim()
  if (!pathWithoutLocation || /^[A-Za-z]$/u.test(pathWithoutLocation)) {
    return filePath
  }
  return pathWithoutLocation
}

function WorkspaceFileLink({
  filePath,
  children,
  onOpenWorkspaceFile,
  className,
}: {
  filePath: string
  children: ReactNode
  onOpenWorkspaceFile: (path: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'workspace-file-link inline break-all underline decoration-[color:var(--hv-border-soft)] underline-offset-2 hover:text-[color:var(--hv-fg)]',
        className,
      )}
      onClick={(event) => {
        event.preventDefault()
        onOpenWorkspaceFile(filePath)
      }}
    >
      {children}
    </button>
  )
}

function MarkdownContent({
  text,
  onOpenWorkspaceFile,
}: {
  text: string
  onOpenWorkspaceFile?: (path: string) => void
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, node: _node, ...props }) => {
          const filePath = normalizeWorkspaceFileHref(href)
          if (!filePath || !onOpenWorkspaceFile) {
            return (
              <a href={href} {...props}>
                {children}
              </a>
            )
          }
          return (
            <WorkspaceFileLink filePath={filePath} onOpenWorkspaceFile={onOpenWorkspaceFile}>
              {children}
            </WorkspaceFileLink>
          )
        },
        code: ({ className, children, node: _node, ...props }) => {
          const textContent = String(children).trim()
          const filePath = !className && !textContent.includes('\n')
            ? normalizeWorkspaceFileHref(textContent)
            : null
          if (!filePath || !onOpenWorkspaceFile) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          }

          return (
            <WorkspaceFileLink
              filePath={filePath}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
              className="font-mono"
            >
              {children}
            </WorkspaceFileLink>
          )
        },
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

export function SystemDivider({ text }: { text: string }) {
  if (!text) {
    return null
  }

  return (
    <div className="message msg-system flex items-center gap-2 px-1 py-1">
      <div className="msg-system-line h-px flex-1 bg-[var(--hv-border-hair)]" />
      <span className="msg-system-text font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-fg)]">
        {text}
      </span>
      <div className="msg-system-line h-px flex-1 bg-[var(--hv-border-hair)]" />
    </div>
  )
}

export function UserMessage({
  text,
  images,
  onOpenWorkspaceFile,
}: {
  text: string
  images?: { mediaType: string; data: string }[]
  onOpenWorkspaceFile?: (path: string) => void
}) {
  return (
    <div className="message msg-user-row flex justify-end">
      <div className="msg-user max-w-[85%] rounded-lg border border-[color:var(--hv-border-soft)] bg-[var(--hv-chat-user-bg,var(--hv-fg))] px-3 py-2 text-sm text-[color:var(--hv-chat-user-fg,var(--hv-fg-inverse))]">
        {images && images.length > 0 && (
          <div className="msg-attachments mb-2 flex flex-wrap gap-2">
            {images.map((image, index) => (
              <img
                key={`${image.mediaType}-${index}`}
                src={`data:${image.mediaType};base64,${image.data}`}
                className="msg-attachment max-h-48 max-w-xs rounded border border-[color:var(--hv-border-soft)]"
                alt="attachment"
              />
            ))}
          </div>
        )}
        {text && text !== '[image]' ? (
          <div className="msg-user-md break-words">
            <MarkdownContent text={text} onOpenWorkspaceFile={onOpenWorkspaceFile} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="message msg-thinking rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-ink-wash-01)]">
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        className="msg-thinking-toggle flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <Brain size={11} className="msg-thinking-icon shrink-0 text-[color:var(--hv-fg-subtle)]" />
        <span className="msg-thinking-label font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-fg-subtle)]">
          Thinking
        </span>
        <ChevronRight
          size={11}
          className={cn(
            'msg-collapse-icon ml-auto shrink-0 text-[color:var(--hv-fg-subtle)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-thinking-body border-t border-[color:var(--hv-border-hair)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[color:var(--hv-fg-muted)] whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  )
}

export function PlanningBlock({
  msg,
  onOpenWorkspaceFile,
}: {
  msg: MsgItem
  onOpenWorkspaceFile?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const action = msg.planningAction ?? 'enter'

  if (action === 'enter') {
    return (
      <div className="message msg-plan rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-ink-wash-01)] px-3 py-2">
        <div className="msg-plan-label flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--hv-fg-subtle)]">
          <FileText size={11} className="msg-plan-icon shrink-0 text-[color:var(--hv-accent-warning)]" />
          <span>Agent entered plan mode</span>
        </div>
      </div>
    )
  }

  if (action === 'proposed') {
    return (
      <div className="message msg-plan rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-ink-wash-01)]">
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="msg-plan-toggle flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <FileText size={12} className="msg-plan-icon shrink-0 text-[color:var(--hv-accent-warning)]" />
          <span className="msg-plan-label font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--hv-fg)]">
            Proposed Plan
          </span>
          <ChevronRight
            size={12}
            className={cn(
              'msg-collapse-icon ml-auto shrink-0 text-[color:var(--hv-fg)] transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>
        {expanded && (
          <div className="msg-plan-body border-t border-[color:var(--hv-border-soft)] px-3 py-3">
            <div className="msg-plan-markdown break-words text-[color:var(--hv-fg)]">
              <MarkdownContent
                text={msg.planningPlan ?? msg.text}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (action !== 'decision') {
    return null
  }

  const decisionLabel =
    msg.planningApproved === true
      ? 'Approved'
      : msg.planningApproved === false
        ? 'Rejected'
        : 'Decision recorded'
  const decisionClass =
    msg.planningApproved === true
      ? 'border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)]'
      : msg.planningApproved === false
        ? 'border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] text-[color:var(--hv-accent-danger)]'
        : 'border-[color:var(--hv-border-soft)] bg-[var(--hv-ink-wash-01)] text-[color:var(--hv-fg)]'
  const DecisionIcon = msg.planningApproved === false ? AlertTriangle : Check
  const decisionMessage = (msg.planningMessage ?? msg.text).trim()

  return (
    <div className="message msg-plan rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-ink-wash-01)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'msg-plan-decision inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]',
            decisionClass,
          )}
        >
          <DecisionIcon size={10} />
          {decisionLabel}
        </span>
      </div>
      {decisionMessage && (
        <div className="msg-plan-body mt-2 border-t border-[color:var(--hv-border-soft)] pt-2 text-sm leading-relaxed text-[color:var(--hv-fg)] whitespace-pre-wrap break-words">
          {decisionMessage}
        </div>
      )}
    </div>
  )
}

export function AgentMessage({
  text,
  avatarUrl,
  accentColor,
  onOpenWorkspaceFile,
}: {
  text: string
  avatarUrl?: string | null
  accentColor?: string | null
  onOpenWorkspaceFile?: (path: string) => void
}) {
  if (!text.trim()) {
    return null
  }

  const safeAccent =
    accentColor && isAgentAccentColor(accentColor) ? accentColor.trim() : null

  return (
    <div className="message msg-agent-row flex items-start gap-2">
      <div className="msg-agent-avatar mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--hv-accent-info-wash)] text-[color:var(--hv-accent-info)]">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Bot size={13} />
        )}
      </div>
      <div
        className={cn(
          'msg-agent min-w-0 flex-1 rounded-r-lg rounded-bl-lg border border-[color:var(--hv-border-soft)] border-l-[3px] bg-[var(--hv-bg-raised)] p-3.5',
          !safeAccent && 'border-l-[color:var(--hv-accent-info)]',
        )}
        style={safeAccent ? { borderLeftColor: safeAccent } : undefined}
      >
        <div className="msg-agent-md break-words text-[color:var(--hv-fg)]">
          <MarkdownContent text={text} onOpenWorkspaceFile={onOpenWorkspaceFile} />
        </div>
      </div>
    </div>
  )
}

export function RunningAgentsPanel({ messages }: { messages: MsgItem[] }) {
  const running = messages.filter(
    (message) =>
      message.kind === 'tool'
      && message.toolName === 'Agent'
      && message.toolStatus === 'running',
  )
  if (running.length === 0) {
    return null
  }

  return (
    <div className="message msg-running-agents rounded border border-[color:var(--hv-accent-info)] bg-[var(--hv-accent-info-wash)] px-2.5 py-2">
      <div className="running-agents-label mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-accent-info)]">
        <Bot size={11} className="running-agents-icon" />
        Running Sub-agents
      </div>
      {running.map((message) => (
        <div key={message.id} className="running-agent-item flex items-center gap-1.5 text-xs text-[color:var(--hv-fg-subtle)]">
          <Loader2 size={10} className="animate-spin" />
          <span>{message.subagentDescription ?? SUBAGENT_WORKING_LABEL}</span>
        </div>
      ))}
    </div>
  )
}

function getToolStatusView(status: MsgItem['toolStatus']) {
  if (status === 'running') {
    return {
      icon: <Loader2 size={11} className="animate-spin text-[color:var(--hv-accent-warning)]" />,
      text: 'running',
      color: 'text-[color:var(--hv-accent-warning)]',
    }
  }
  if (status === 'error') {
    return {
      icon: <AlertTriangle size={11} className="text-[color:var(--hv-accent-danger)]" />,
      text: 'error',
      color: 'text-[color:var(--hv-accent-danger)]',
    }
  }
  return {
    icon: <Check size={11} className="text-[color:var(--hv-accent-success)]" />,
    text: 'done',
    color: 'text-[color:var(--hv-accent-success)]',
  }
}

function NestedActivity({
  children,
  onAnswer,
}: {
  children: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
}) {
  return (
    <div className="msg-tool-activity space-y-1 rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] p-1.5">
      {children.map((child) => {
        switch (child.kind) {
          case 'system':
            return <SystemDivider key={child.id} text={child.text} />
          case 'tool':
            return <ToolBlock key={child.id} msg={child} nested onAnswer={onAnswer} />
          case 'agent':
            return <AgentMessage key={child.id} text={child.text} />
          case 'thinking':
            return <ThinkingBlock key={child.id} text={child.text} />
          case 'planning':
            return <PlanningBlock key={child.id} msg={child} />
          case 'user':
            return <UserMessage key={child.id} text={child.text} images={child.images} />
          case 'ask':
            return (
              <AskUserQuestionBlock
                key={child.id}
                msg={child}
                onAnswer={onAnswer}
              />
            )
          default:
            return null
        }
      })}
    </div>
  )
}

export function SubagentBlock({
  msg,
  onAnswer,
  nested = false,
}: {
  msg: MsgItem
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  nested?: boolean
}) {
  const children = msg.children ?? []
  const hasChildren = children.length > 0
  const hasOutput = Boolean(msg.toolOutput?.trim())
  const hasInput = Boolean(msg.toolInput?.trim())
  const [expanded, setExpanded] = useState(true)
  const status = getToolStatusView(msg.toolStatus)
  const description = msg.subagentDescription?.trim() || SUBAGENT_WORKING_LABEL

  return (
    <div
      className={cn(
        'message msg-subagent rounded border border-[color:var(--hv-accent-info)] bg-[var(--hv-accent-info-wash)]',
        nested && 'border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)]',
      )}
      data-nested={nested || undefined}
    >
      <button
        type="button"
        className="msg-subagent-header flex w-full items-start gap-2 px-3 py-2.5 text-left"
        onClick={() => setExpanded((previous) => !previous)}
      >
        <div className="msg-subagent-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--hv-accent-info-wash)] text-[color:var(--hv-accent-info)]">
          <Bot size={13} />
        </div>
        <div className="msg-subagent-meta min-w-0 flex-1">
          <div className="msg-subagent-label font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--hv-accent-info)]">
            Sub-agent
          </div>
          <div className="msg-subagent-description mt-0.5 break-words text-sm leading-relaxed text-[color:var(--hv-fg)]">
            {description}
          </div>
        </div>
        <div
          className={cn(
            'msg-subagent-status mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-raised)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
            status.color,
          )}
        >
          {status.icon}
          <span>{status.text}</span>
        </div>
        <ChevronRight
          size={12}
          className={cn(
            'msg-collapse-icon mt-1.5 shrink-0 text-[color:var(--hv-fg)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-subagent-body border-t border-[color:var(--hv-border-soft)] px-3 py-2.5">
          {hasChildren && (
            <div className="msg-subagent-section">
              <div className="msg-subagent-section-label mb-1 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-fg-subtle)]">
                activity
              </div>
              <NestedActivity children={children} onAnswer={onAnswer} />
            </div>
          )}
          {hasOutput && (
            <div className={cn('msg-subagent-section', hasChildren && 'mt-2 border-t border-[color:var(--hv-border-soft)] pt-2')}>
              <div className="msg-subagent-section-label mb-1 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-fg-subtle)]">
                result
              </div>
              <div className="msg-subagent-output whitespace-pre-wrap break-words rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[color:var(--hv-fg)]">
                {msg.toolOutput}
              </div>
            </div>
          )}
          {!hasChildren && !hasOutput && (
            <div className="msg-subagent-empty rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-2 py-1.5 font-mono text-[11px] text-[color:var(--hv-fg-subtle)]">
              {msg.toolStatus === 'running'
                ? 'Waiting for sub-agent activity.'
                : hasInput
                  ? 'No sub-agent activity was recorded.'
                  : 'Sub-agent activity unavailable.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolBlock({
  msg,
  onAnswer,
  nested = false,
}: {
  msg: MsgItem
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  nested?: boolean
}) {
  const isAgentTool = msg.toolName === 'Agent'
  if (isAgentTool) {
    return <SubagentBlock msg={msg} onAnswer={onAnswer} nested={nested} />
  }

  const children = msg.children ?? []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(false)
  const meta = getToolMeta(msg.toolName ?? '')
  const ToolIcon = meta.icon
  const formatted = formatToolDisplayName(msg.toolName ?? '')
  const hasEditDiff =
    (msg.toolName === 'Edit' || msg.toolName === 'MultiEdit')
    && (msg.oldString || msg.newString)

  const status = getToolStatusView(msg.toolStatus)

  void onAnswer

  return (
    <div
      className={cn(
        'message msg-tool rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)]',
        nested && 'border-[color:var(--hv-border-soft)]',
      )}
      data-nested={nested || undefined}
    >
      <button
        type="button"
        className="msg-tool-header flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setExpanded((previous) => !previous)}
      >
        <div className={cn('msg-tool-icon shrink-0', meta.colorClass)}>
          <ToolIcon size={13} />
        </div>
        <div className="msg-tool-meta min-w-0 flex-1">
          <div className="msg-tool-title truncate font-mono text-[11px] text-[color:var(--hv-fg)]">
            {formatted.service && (
              <span className="mr-1 text-[10px] text-[color:var(--hv-fg)]">
                {formatted.service}
                <span className="mx-1 opacity-50">/</span>
              </span>
            )}
            {formatted.displayName}
          </div>
          {msg.toolFile && (
            <div className="msg-tool-path truncate font-mono text-[10px] text-[color:var(--hv-fg)]">
              {msg.toolFile}
            </div>
          )}
        </div>
        <div
          className={cn(
            'msg-tool-status flex shrink-0 items-center gap-1 font-mono text-[10px]',
            status.color,
          )}
        >
          {status.icon}
          <span>{status.text}</span>
        </div>
        <ChevronRight
          size={12}
          className={cn(
            'msg-collapse-icon shrink-0 text-[color:var(--hv-fg)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-tool-body border-t border-[color:var(--hv-border-soft)] px-2.5 py-2 font-mono text-[11px] text-[color:var(--hv-fg)]">
          {hasEditDiff ? (
            <div className="msg-tool-diff space-y-1">
              {msg.oldString && (
                <div className="msg-tool-diff-old whitespace-pre-wrap break-words rounded bg-[var(--hv-accent-danger-wash)] px-2 py-1 text-[color:var(--hv-accent-danger)] line-through">
                  {msg.oldString}
                </div>
              )}
              {msg.newString && (
                <div className="msg-tool-diff-new whitespace-pre-wrap break-words rounded bg-[var(--hv-accent-success-wash)] px-2 py-1 text-[color:var(--hv-accent-success)]">
                  {msg.newString}
                </div>
              )}
            </div>
          ) : (
            <div className="msg-tool-input whitespace-pre-wrap break-words">{msg.toolInput ?? ''}</div>
          )}
          {msg.toolOutput && (
            <div className="msg-tool-output mt-2 border-t border-[color:var(--hv-border-soft)] pt-2">
              <div className="msg-tool-section-label mb-1 uppercase tracking-widest text-[10px] text-[color:var(--hv-fg)]">
                output
              </div>
              <div className="msg-tool-output-text whitespace-pre-wrap break-words text-[color:var(--hv-fg)]">
                {msg.toolOutput}
              </div>
            </div>
          )}
          {hasChildren && (
            <div className="msg-tool-output mt-2 border-t border-[color:var(--hv-border-soft)] pt-2">
              <div className="msg-tool-section-label mb-1 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-fg)]">
                activity
              </div>
              <NestedActivity children={children} onAnswer={onAnswer} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolCallGroup({
  tools,
  onAnswer,
}: {
  tools: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const running = tools.filter((tool) => tool.toolStatus === 'running').length
  const errors = tools.filter((tool) => tool.toolStatus === 'error').length
  const done = tools.filter((tool) => tool.toolStatus === 'success').length

  const statusLabel =
    running > 0 ? `${running} running` : errors > 0 ? `${errors} failed` : 'done'
  const statusColor =
    running > 0
      ? 'text-[color:var(--hv-accent-warning)]'
      : errors > 0
        ? 'text-[color:var(--hv-accent-danger)]'
        : 'text-[color:var(--hv-accent-success)]'

  return (
    <div className="message msg-tool-group rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)]">
      <button
        type="button"
        className="msg-tool-group-header flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setExpanded((previous) => !previous)}
      >
        <ChevronsUpDown size={12} className="msg-tool-group-icon shrink-0 text-[color:var(--hv-fg)]" />
        <span className="msg-tool-group-count font-mono text-[11px] text-[color:var(--hv-fg)]">
          {tools.length} tool calls
        </span>
        <div
          className={cn(
            'msg-tool-group-status flex shrink-0 items-center gap-1 font-mono text-[10px]',
            statusColor,
          )}
        >
          {running > 0 ? (
            <Loader2 size={10} className="animate-spin" />
          ) : errors > 0 ? (
            <AlertTriangle size={10} />
          ) : (
            <Check size={10} />
          )}
          <span>{statusLabel}</span>
        </div>
        {done > 0 && running > 0 && (
          <span className="msg-tool-group-progress font-mono text-[10px] text-[color:var(--hv-fg)]">
            {done}/{tools.length}
          </span>
        )}
        <ChevronRight
          size={12}
          className={cn(
            'msg-collapse-icon ml-auto shrink-0 text-[color:var(--hv-fg)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-tool-group-body border-t border-[color:var(--hv-border-soft)] space-y-1 p-1.5">
          {tools.map((tool) => (
            <ToolBlock key={tool.id} msg={tool} onAnswer={onAnswer} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AskUserQuestionBlock({
  msg,
  onAnswer,
}: {
  msg: MsgItem
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
}) {
  const questions = msg.askQuestions ?? []
  const [planResponse, setPlanResponse] = useState('')
  const [selections, setSelections] = useState<Record<number, string[]>>(() =>
    Object.fromEntries(questions.map((_, index) => [index, []])),
  )
  const [customTexts, setCustomTexts] = useState<Record<number, string>>(() =>
    Object.fromEntries(questions.map((_, index) => [index, ''])),
  )

  if (msg.askAnswered) {
    return (
      <div className="message msg-ask-done flex items-center gap-1.5 rounded border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-2.5 py-2 font-mono text-[11px] text-[color:var(--hv-accent-success)]">
        <Check size={11} />
        <span>Response submitted</span>
      </div>
    )
  }

  if (msg.askInteractionKind === 'plan_approval') {
    function submitPlanDecision(decision: 'approve' | 'reject') {
      const response = planResponse.trim()
      onAnswer(msg.toolId ?? '', {
        decision: [decision],
        ...(response ? { message: [response] } : {}),
      })
    }

    return (
      <div className="message msg-plan-approval rounded border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-2.5 py-2">
        <div className="msg-plan-approval-label mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-accent-success)]">
          <FileText size={11} />
          <span>Plan Approval</span>
        </div>
        <div className="msg-plan-approval-body rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-3 py-2 text-sm text-[color:var(--hv-fg)]">
          <MarkdownContent text={msg.planApprovalPlan ?? msg.text} />
        </div>
        <textarea
          className="msg-plan-approval-response mt-2 min-h-16 w-full resize-y rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-2 py-1.5 text-xs text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg-subtle)] focus:border-[color:var(--hv-accent-success)] focus:outline-none"
          placeholder={msg.planApprovalCustomResponseLabel ?? 'Add response'}
          value={planResponse}
          onChange={(event) => setPlanResponse(event.target.value)}
        />
        <div className="msg-plan-approval-actions mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => submitPlanDecision('approve')}
            disabled={!!msg.askSubmitting}
            className="msg-plan-approval-approve flex items-center gap-1 rounded border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-accent-success)] transition enabled:hover:bg-[var(--hv-accent-success-wash)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={11} />
            <span>{msg.askSubmitting ? 'Submitting...' : msg.planApprovalApproveLabel ?? 'Approve'}</span>
          </button>
          <button
            type="button"
            onClick={() => submitPlanDecision('reject')}
            disabled={!!msg.askSubmitting}
            className="msg-plan-approval-reject flex items-center gap-1 rounded border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-accent-danger)] transition enabled:hover:bg-[var(--hv-accent-danger-wash)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AlertTriangle size={11} />
            <span>{msg.askSubmitting ? 'Submitting...' : msg.planApprovalRejectLabel ?? 'Reject'}</span>
          </button>
        </div>
      </div>
    )
  }

  function toggleOption(questionIndex: number, label: string, multiSelect: boolean) {
    setSelections((prev) => {
      const current = prev[questionIndex] ?? []
      if (multiSelect) {
        return {
          ...prev,
          [questionIndex]: current.includes(label)
            ? current.filter((value) => value !== label)
            : [...current, label],
        }
      }
      return { ...prev, [questionIndex]: [label] }
    })
  }

  function handleSubmit() {
    const answers: Record<string, string[]> = {}
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i]
      const selected = selections[i] ?? []
      const custom = customTexts[i]?.trim()
      answers[question.question] = custom ? [...selected, custom] : selected
    }
    onAnswer(msg.toolId ?? '', answers)
  }

  const allAnswered = questions.every((_, index) => {
    const selected = selections[index] ?? []
    const custom = customTexts[index]?.trim()
    return selected.length > 0 || Boolean(custom)
  })

  return (
    <div className="message msg-ask rounded border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-2.5 py-2">
      <div className="msg-ask-label mb-2 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-accent-success)]">
        Question
      </div>
      <div className="msg-ask-questions space-y-3">
        {questions.map((question, questionIndex) => (
          <div key={questionIndex} className="msg-ask-question">
            <p className="msg-ask-question-text mb-1.5 text-sm text-[color:var(--hv-fg)]">{question.question}</p>
            <div className="msg-ask-options flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const selected = (selections[questionIndex] ?? []).includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() =>
                      toggleOption(questionIndex, option.label, question.multiSelect)
                    }
                    title={option.description}
                    className={cn(
                      'msg-ask-chip flex items-center gap-1 rounded border px-2 py-1 text-xs transition',
                      selected
                        ? 'border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)]'
                        : 'border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] text-[color:var(--hv-fg)] hover:border-[color:var(--hv-border-soft)]',
                    )}
                  >
                    {selected && <Check size={10} />}
                    {option.label}
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              className="msg-ask-other mt-1.5 w-full rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-2 py-1 text-xs text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg)] focus:border-[color:var(--hv-accent-success)] focus:outline-none"
              placeholder="Other..."
              value={customTexts[questionIndex] ?? ''}
              onChange={(event) =>
                setCustomTexts((prev) => ({ ...prev, [questionIndex]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allAnswered || !!msg.askSubmitting}
        className="msg-ask-submit mt-3 rounded border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--hv-accent-success)] transition enabled:hover:bg-[var(--hv-accent-success-wash)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {msg.askSubmitting ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  )
}
