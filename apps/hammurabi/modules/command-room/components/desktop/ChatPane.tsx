import type { PendingApproval } from '@/hooks/use-approvals'
import Transcript from '@modules/agents/components/Transcript'
import type { MsgItem } from '@modules/agents/messages/model'
import ApprovalCard from '@modules/approvals/ApprovalCard'

interface ChatPaneProps {
  messages?: MsgItem[]
  approvals?: PendingApproval[]
  onApprove: (approval: PendingApproval) => void
  onDeny: (approval: PendingApproval) => void
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  agentAvatarUrl?: string | null
  agentAccentColor?: string | null
  sessionId?: string
  hasOlderMessages?: boolean
  loadingOlderMessages?: boolean
  onLoadOlderMessages?: () => void
}

function ApprovalDivider() {
  return (
    <div
      style={{
        padding: '18px 0 6px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--hv-fg-faint)',
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--hv-border-hair)' }} />
      <span>action awaiting approval</span>
      <div style={{ flex: 1, height: 1, background: 'var(--hv-border-hair)' }} />
    </div>
  )
}

export function ChatPane({
  messages = [],
  approvals = [],
  onApprove,
  onDeny,
  onAnswer,
  agentAvatarUrl,
  agentAccentColor,
  sessionId = 'hervald-chat',
  hasOlderMessages = false,
  loadingOlderMessages = false,
  onLoadOlderMessages,
}: ChatPaneProps) {
  return (
    <div
      className="hervald-chat-pane"
      style={{
        padding: '20px 32px 16px',
      }}
    >
      {hasOlderMessages && onLoadOlderMessages && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
          <button
            type="button"
            className="font-body"
            onClick={onLoadOlderMessages}
            disabled={loadingOlderMessages}
            style={{
              border: '1px solid var(--hv-border-hair)',
              borderRadius: '2px 8px 2px 8px',
              background: 'var(--hv-bg-raised)',
              color: 'var(--hv-fg-subtle)',
              cursor: loadingOlderMessages ? 'wait' : 'pointer',
              fontSize: 11,
              letterSpacing: '0.08em',
              padding: '6px 10px',
              textTransform: 'uppercase',
            }}
          >
            {loadingOlderMessages ? 'Loading...' : 'Load older'}
          </button>
        </div>
      )}

      <Transcript
        messages={messages}
        sessionId={sessionId}
        onAnswer={onAnswer}
        agentAvatarUrl={agentAvatarUrl ?? undefined}
        agentAccentColor={agentAccentColor ?? undefined}
        className="hervald-chat-transcript"
      />

      {approvals.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <ApprovalDivider />
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={() => onApprove(approval)}
              onDeny={() => onDeny(approval)}
              compact
            />
          ))}
        </div>
      )}
    </div>
  )
}
