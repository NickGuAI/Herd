import path from 'node:path'
import { homedir } from 'node:os'

/**
 * Resolve the root Herd data directory.
 *
 * Priority: HERD_DATA_DIR env var > HERD_DATA_DIR env var > ~/.herd/
 */
export function resolveHerdDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HERD_DATA_DIR?.trim() || env.HERD_DATA_DIR?.trim()
  if (configured && configured.length > 0) {
    return path.resolve(configured)
  }
  return path.join(homedir(), '.herd')
}

/**
 * Resolve a module-scoped data directory under the Herd data root.
 *
 * Example: resolveModuleDataDir('telemetry') => ~/.herd/telemetry
 */
export function resolveModuleDataDir(module: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHerdDataDir(env), module)
}

export function resolveAutomationsDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveModuleDataDir('automations', env)
}
