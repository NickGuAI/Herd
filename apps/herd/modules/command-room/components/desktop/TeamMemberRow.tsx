/**
 * Herd — TeamMemberRow
 *
 * A single row in the Team column worker list.
 * Selected state gets a carved-radius border + whisper shadow.
 */
import { Chip, StatusDot } from '@modules/components/herd'

export interface Worker {
  id: string
  name: string
  label?: string
  kind: string
  state: string
}

interface TeamMemberRowProps {
  worker: Worker
  selected: boolean
  onClick: () => void
  approvalCount: number
}

function stateTone(state: string) {
  if (state === 'running') {
    return 'success' as const
  }
  if (state === 'stale') {
    return 'warning' as const
  }
  if (state === 'exited') {
    return 'neutral' as const
  }
  return 'ink' as const
}

export function TeamMemberRow({ worker, selected, onClick, approvalCount }: TeamMemberRowProps) {
  return (
    <button
      className="font-body"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 16px',
        // Inset by 10px each side when selected so border fits inside the column
        margin: selected ? '4px 10px' : '0',
        width: selected ? 'calc(100% - 20px)' : '100%',
        background: 'transparent',
        border: selected ? '1px solid var(--hv-border-firm)' : '1px solid transparent',
        borderRadius: selected ? '2px 10px 2px 10px' : 0,
        boxShadow: selected ? 'var(--hv-shadow-whisper)' : 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s var(--hv-ease-gentle), box-shadow 0.15s var(--hv-ease-gentle)',
      }}
    >
      {/* Status dot — 6px as spec'd */}
      <StatusDot state={worker.state} size={6} style={{ marginTop: 7 }} />

      {/* Name + label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 12.5,
              color: 'var(--hv-fg)',
            }}
          >
            {worker.name}
          </span>
          <Chip tone={stateTone(worker.state)} style={{ padding: '2px 7px', fontSize: 9.5 }}>
            {worker.state}
          </Chip>
          {worker.kind === 'tool' && (
            <span
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: 'var(--hv-fg-faint)',
              }}
            >
              &amp; {worker.name === 'researcher' ? 'fetcher' : 'caller'}
            </span>
          )}
        </div>
        <div
          className="font-body"
          style={{
            fontSize: 11,
            color: 'var(--hv-fg-subtle)',
            marginTop: 2,
            fontStyle: 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {worker.label ?? worker.kind}
        </div>
      </div>

      {/* Approval badge — vermillion count */}
      {approvalCount > 0 && (
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: 'var(--vermillion-seal)',
            marginTop: 6,
            flexShrink: 0,
          }}
        >
          {approvalCount}
        </span>
      )}
    </button>
  )
}
