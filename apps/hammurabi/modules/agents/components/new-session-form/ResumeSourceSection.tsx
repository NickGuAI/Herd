import type { AgentSession, Machine } from '@/types'
import { getMachineDisplayValue, getResumeSourceStateLabel } from './helpers'

interface ResumeSourceSectionProps {
  resumeSourceName: string
  setResumeSourceName?: (value: string) => void
  resumeOptions?: AgentSession[]
  resumeSource: AgentSession | null
  machines: Machine[]
}

export function ResumeSourceSection({
  resumeSourceName,
  setResumeSourceName,
  resumeOptions,
  resumeSource,
  machines,
}: ResumeSourceSectionProps) {
  return (
    <div>
      <label className="section-title block mb-2">Resume From Previous Session</label>
      <select
        value={resumeSourceName}
        onChange={(event) => setResumeSourceName?.(event.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]"
      >
        <option value="">— Start fresh —</option>
        {(resumeOptions ?? []).map((session) => (
          <option key={session.name} value={session.name}>
            {session.name} · {session.agentType ?? 'claude'} · {getResumeSourceStateLabel(session)}
          </option>
        ))}
      </select>
      <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
        Only resumable provider sessions appear here.
      </p>
      {resumeSource ? (
        <div className="mt-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2 text-sm text-[color:var(--hv-fg-muted)]">
          <div className="font-mono text-xs text-[color:var(--hv-fg)]">{resumeSource.name}</div>
          <div className="mt-1 text-whisper">State: {getResumeSourceStateLabel(resumeSource)}</div>
          <div className="text-whisper">Machine: {getMachineDisplayValue(resumeSource, machines)}</div>
          <div className="text-whisper break-all">Workspace: {resumeSource.cwd ?? 'Home directory'}</div>
          <div className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
            Agent, session type, machine, and workspace are locked to the selected source.
          </div>
        </div>
      ) : null}
    </div>
  )
}
