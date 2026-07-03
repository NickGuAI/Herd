import {
  workerLifecycle,
  type WorkerLifecycle,
  type WorkerLifecycleSessionLike,
} from '@gehirn/herd-cli/session-contract'

export type RuntimeSessionState = 'active' | 'paused' | 'archived'

export function workerLifecycleFromRuntimeState(
  state: RuntimeSessionState | null | undefined,
): WorkerLifecycle | null {
  if (state === 'active') {
    return 'running'
  }
  if (state === 'paused') {
    return 'stale'
  }
  if (state === 'archived') {
    return 'exited'
  }
  return null
}

export function workerLifecycleWithRuntimeState(
  session: WorkerLifecycleSessionLike & { state?: RuntimeSessionState | null },
): WorkerLifecycle {
  return workerLifecycleFromRuntimeState(session.state) ?? workerLifecycle(session)
}
