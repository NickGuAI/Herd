import type { ChildProcess } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

export interface ProviderProcessTree {
  ownership: 'process-group' | 'transport-process-group' | 'daemon-process-group' | 'single-process'
  processGroupId?: number
}

export function ownedTransportProcessGroup(child: ChildProcess): ProviderProcessTree {
  const owned = ownedLocalProcessGroup(child)
  return owned.ownership === 'process-group'
    ? { ...owned, ownership: 'transport-process-group' }
    : owned
}

function ownsProcessGroup(tree: ProviderProcessTree | undefined): boolean {
  return tree?.ownership === 'process-group' || tree?.ownership === 'transport-process-group'
}

export function ownedLocalProcessGroup(child: ChildProcess): ProviderProcessTree {
  const pid = child.pid
  return Number.isInteger(pid) && (pid ?? 0) > 0
    ? { ownership: 'process-group', processGroupId: pid }
    : { ownership: 'single-process' }
}

export function signalProviderProcess(
  child: ChildProcess,
  tree: ProviderProcessTree | undefined,
  signal: NodeJS.Signals,
  killProcess: typeof process.kill = process.kill,
): boolean {
  if (ownsProcessGroup(tree) && tree?.processGroupId && tree.processGroupId > 0) {
    try {
      return killProcess(-tree.processGroupId, signal)
    } catch {
      // The group may have disappeared between the ownership check and signal.
    }
  }
  try {
    return child.kill(signal)
  } catch {
    return false
  }
}

export function providerProcessAlive(
  child: ChildProcess,
  tree: ProviderProcessTree | undefined,
  killProcess: typeof process.kill = process.kill,
): boolean {
  if (ownsProcessGroup(tree) && tree?.processGroupId && tree.processGroupId > 0) {
    try {
      killProcess(-tree.processGroupId, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }
  return child.exitCode === null && child.signalCode === null
}

export async function waitForProviderProcessExit(
  child: ChildProcess,
  tree: ProviderProcessTree | undefined,
  timeoutMs: number,
  options: { pollMs?: number; killProcess?: typeof process.kill } = {},
): Promise<boolean> {
  const killProcess = options.killProcess ?? process.kill
  if (!providerProcessAlive(child, tree, killProcess)) {
    return true
  }

  const deadline = Date.now() + Math.max(0, timeoutMs)
  const pollMs = Math.max(10, options.pollMs ?? 25)
  return await new Promise<boolean>((resolve) => {
    const check = () => {
      if (!providerProcessAlive(child, tree, killProcess)) {
        resolve(true)
        return
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        resolve(false)
        return
      }
      const timer = setTimeout(check, Math.min(pollMs, remaining))
      timer.unref?.()
    }
    check()
  })
}

export function listProviderProcessMembers(tree: ProviderProcessTree | undefined): number[] {
  const groupId = ownsProcessGroup(tree) ? tree?.processGroupId : undefined
  if (!groupId || process.platform !== 'linux') {
    return []
  }
  try {
    return readdirSync('/proc', { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .flatMap((entry) => {
        try {
          const stat = readFileSync(`/proc/${entry.name}/stat`, 'utf8')
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
          return Number.parseInt(fields[2] ?? '', 10) === groupId
            ? [Number.parseInt(entry.name, 10)]
            : []
        } catch {
          return []
        }
      })
      .sort((left, right) => left - right)
  } catch {
    return []
  }
}
