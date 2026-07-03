import { useMemo } from 'react'
import { workerLifecycleWithRuntimeState } from '@modules/agents/session-lifecycle'
import { useAgentSessions } from '@/hooks/use-agents'

export interface SessionLifecycleCounts {
  running: number
  stale: number
  exited: number
}

export interface SessionLifecycleCountInput {
  state?: 'active' | 'paused' | 'archived'
  status?: string | null
  processAlive?: boolean | null
}

export function countSessionLifecycles(sessions: readonly SessionLifecycleCountInput[]): SessionLifecycleCounts {
  let running = 0
  let stale = 0
  let exited = 0

  for (const session of sessions) {
    const lifecycle = workerLifecycleWithRuntimeState({
      state: session.state,
      status: session.status,
      processAlive: session.processAlive,
    })
    if (lifecycle === 'running') running += 1
    if (lifecycle === 'stale') stale += 1
    if (lifecycle === 'exited') exited += 1
  }

  return { running, stale, exited }
}

export function useSessionLifecycleCounts(): SessionLifecycleCounts {
  const { data: sessions = [] } = useAgentSessions()

  return useMemo(() => {
    return countSessionLifecycles(sessions)
  }, [sessions])
}
