import type { MsgItem } from '../messages/model'
import {
  AgentActivityGroup,
  AgentMessage,
  AskUserQuestionBlock,
  PlanningBlock,
  ProviderActivityBlock,
  ProviderErrorBlock,
  RunningAgentsPanel,
  SystemDivider,
  ThinkingBlock,
  ToolBlock,
  UserMessage,
} from './session-message-list/blocks'
import { groupMessages } from './session-message-list/render-items'

function getCredentialRecoveryResolvedErrorIds(messages: readonly MsgItem[]): Set<string> {
  const pendingUsageLimitErrorsByProvider = new Map<string, string[]>()
  const resolvedErrorIds = new Set<string>()
  const visit = (items: readonly MsgItem[]) => {
    for (const message of items) {
      const provider = message.transcript?.source?.provider
      if (
        message.kind === 'error'
        && (
          message.providerError?.classification === 'usage_limit'
          || message.providerError?.classification === 'auth_required'
        )
        && provider
      ) {
        const pending = pendingUsageLimitErrorsByProvider.get(provider) ?? []
        pending.push(message.id)
        pendingUsageLimitErrorsByProvider.set(provider, pending)
      }
      if (message.transcript?.providerEventType === 'credential_pool_recovery') {
        if (provider) {
          for (const messageId of pendingUsageLimitErrorsByProvider.get(provider) ?? []) {
            resolvedErrorIds.add(messageId)
          }
          pendingUsageLimitErrorsByProvider.set(provider, [])
        }
      }
      if (message.children) {
        visit(message.children)
      }
    }
  }
  visit(messages)
  return resolvedErrorIds
}

export interface SessionMessageListProps {
  messages: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  sessionName?: string
  sessionHost?: string
  emptyLabel?: string
  agentAvatarUrl?: string | null
  agentAccentColor?: string | null
  onOpenWorkspaceFile?: (path: string) => void
}

export function SessionMessageList({
  messages,
  onAnswer,
  sessionName,
  sessionHost,
  emptyLabel = 'No messages yet.',
  agentAvatarUrl,
  agentAccentColor,
  onOpenWorkspaceFile,
}: SessionMessageListProps) {
  if (messages.length === 0) {
    return (
      <p className="session-message-empty rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-2 py-1.5 font-mono text-[11px] text-[color:var(--hv-fg)]">
        {emptyLabel}
      </p>
    )
  }

  const credentialRecoveryResolvedErrorIds = getCredentialRecoveryResolvedErrorIds(messages)

  return (
    <div className="session-message-list space-y-2">
      <RunningAgentsPanel messages={messages} />
      {groupMessages(messages).map((item) => {
        if (item.type === 'activity-group') {
          return (
            <AgentActivityGroup
              key={item.id}
              messages={item.messages}
              onAnswer={onAnswer}
              sessionName={sessionName}
              sessionHost={sessionHost}
              credentialRecoveryResolvedErrorIds={credentialRecoveryResolvedErrorIds}
            />
          )
        }

        const message = item.msg
        switch (message.kind) {
          case 'system':
            return <SystemDivider key={message.id} text={message.text} />
          case 'user':
            return (
              <UserMessage
                key={message.id}
                text={message.text}
                images={message.images}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
              />
            )
          case 'thinking':
            return <ThinkingBlock key={message.id} text={message.text} />
          case 'planning':
            return <PlanningBlock key={message.id} msg={message} onOpenWorkspaceFile={onOpenWorkspaceFile} />
          case 'agent':
            return (
              <AgentMessage
                key={message.id}
                text={message.text}
                images={message.images}
                avatarUrl={agentAvatarUrl}
                accentColor={agentAccentColor}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
              />
            )
          case 'tool':
            return (
              <ToolBlock
                key={message.id}
                msg={message}
                onAnswer={onAnswer}
                sessionName={sessionName}
                sessionHost={sessionHost}
              />
            )
          case 'ask':
            return <AskUserQuestionBlock key={message.id} msg={message} onAnswer={onAnswer} />
          case 'provider':
            return <ProviderActivityBlock key={message.id} msg={message} />
          case 'error':
            return (
              <ProviderErrorBlock
                key={message.id}
                msg={message}
                sessionName={sessionName}
                sessionHost={sessionHost}
                credentialRecoveryResolved={credentialRecoveryResolvedErrorIds.has(message.id)}
              />
            )
          default:
            return null
        }
      })}
    </div>
  )
}
