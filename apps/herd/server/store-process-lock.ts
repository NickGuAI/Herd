import path from 'node:path'
import {
  acquireFileLock,
  type HeldFileLock,
} from '../modules/durable-file.js'
import { resolveHerdDataDir } from '../modules/data-dir.js'

const MALFORMED_LOCK_STALE_MS = 60 * 60 * 1000

export function resolveHerdStoreLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHerdDataDir(env), '.store-writer.lock')
}

export async function acquireHerdStoreProcessLock(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HeldFileLock> {
  return acquireFileLock(resolveHerdStoreLockPath(env), {
    staleMs: MALFORMED_LOCK_STALE_MS,
  })
}
