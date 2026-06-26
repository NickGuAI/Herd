/**
 * Herd — StatusPill
 *
 * Compact status badge for commander state.
 * tone variants: waiting (orange), running (green), pending (red)
 * Border radius: 2px 6px 2px 6px
 */
import type { ReactNode } from 'react'

type StatusTone = 'waiting' | 'running' | 'pending'

interface StatusPillProps {
  tone: StatusTone
  children: ReactNode
}

const TONE_STYLES: Record<StatusTone, React.CSSProperties> = {
  waiting: {
    background: 'var(--hv-accent-warning-wash)',
    color: 'var(--hv-accent-warning)',
    border: '1px solid var(--hv-accent-warning)',
  },
  running: {
    background: 'var(--hv-accent-success-wash)',
    color: 'var(--hv-accent-success)',
    border: '1px solid var(--hv-accent-success)',
  },
  pending: {
    background: 'var(--hv-accent-danger-wash)',
    color: 'var(--hv-accent-danger)',
    border: '1px solid var(--hv-accent-danger)',
  },
}

export function StatusPill({ tone, children }: StatusPillProps) {
  return (
    <span
      className="font-body"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 9px',
        borderRadius: '2px 6px 2px 6px',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 500,
        ...TONE_STYLES[tone],
      }}
    >
      {children}
    </span>
  )
}
