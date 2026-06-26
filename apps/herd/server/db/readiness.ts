import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveHerdDataDir } from '../../modules/data-dir.js'
import {
  applyHerdSqliteSchema,
  canUpgradeHerdSqliteSchemaInPlace,
  HERD_SQLITE_SCHEMA_VERSION,
  isHerdSqliteSchemaCurrent,
  readAppliedHerdSchemaVersions,
} from './schema.js'
import {
  openHerdSqliteDatabase,
  probeHerdSqliteWritable,
  resolveHerdDbPath,
} from './connection.js'

export type HerdDatabaseMigrationStatus =
  | 'ready'
  | 'fresh-initialized'
  | 'migration-required'
  | 'stale'
  | 'corrupt'
  | 'unwritable'

export interface HerdDatabaseReadiness {
  ready: boolean
  dbPath: string
  sourceRoot: string
  schemaVersion: string | null
  requiredSchemaVersion: string
  migrationStatus: HerdDatabaseMigrationStatus
  migrationRequired: boolean
  remediationCommand: string
  hasLegacyState: boolean
  error: string | null
}

export class HerdDatabaseNotReadyError extends Error {
  constructor(readonly readiness: HerdDatabaseReadiness) {
    super(formatDatabaseNotReadyMessage(readiness))
    this.name = 'HerdDatabaseNotReadyError'
  }
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildSqliteMigrationCommand(input: {
  sourceRoot: string
  dbPath: string
  backup?: boolean
  replace?: boolean
}): string {
  return [
    'pnpm --filter herd run migrate:sqlite --',
    '--source-root',
    quoteShell(input.sourceRoot),
    '--db',
    quoteShell(input.dbPath),
    input.backup === false ? '--backup=false' : '--backup',
    ...(input.replace ? ['--replace'] : []),
  ].join(' ')
}

function formatDatabaseNotReadyMessage(readiness: HerdDatabaseReadiness): string {
  const detail = readiness.error ? `\n${readiness.error}` : ''
  return [
    '[database] Herd SQLite runtime-session store is not ready.',
    `status: ${readiness.migrationStatus}`,
    `db: ${readiness.dbPath}`,
    `required schema: ${readiness.requiredSchemaVersion}`,
    `remediation: ${readiness.remediationCommand}`,
    detail,
  ].filter(Boolean).join('\n')
}

export async function hasLegacyHerdState(sourceRoot: string): Promise<boolean> {
  const sessionStorePath = path.join(sourceRoot, 'agents', 'stream-sessions.json')
  try {
    const sessionStoreStat = await stat(sessionStorePath)
    if (!sessionStoreStat.isFile() || sessionStoreStat.size === 0) {
      return false
    }
    const raw = await readFile(sessionStorePath, 'utf8')
    if (!raw.trim()) {
      return false
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      const payload = typeof parsed === 'object' && parsed !== null
        ? parsed as { sessions?: unknown }
        : null
      return Array.isArray(payload?.sessions)
        ? payload.sessions.length > 0
        : true
    } catch {
      return true
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function countNonArchivedRuntimeSessions(db: ReturnType<typeof openHerdSqliteDatabase>): number {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_runtime_sessions'",
  ).get()
  if (!table) {
    return 0
  }

  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM agent_runtime_sessions WHERE state <> 'archived'",
  ).get() as { count: number }
  return Number(row.count)
}

export async function inspectHerdDatabaseReadiness(options: {
  env?: NodeJS.ProcessEnv
  sourceRoot?: string
  dbPath?: string
  initializeFresh?: boolean
} = {}): Promise<HerdDatabaseReadiness> {
  const env = options.env ?? process.env
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveHerdDataDir(env))
  const dbPath = path.resolve(options.dbPath ?? resolveHerdDbPath(env))
  const remediationCommand = buildSqliteMigrationCommand({ sourceRoot, dbPath })
  const hasLegacyState = await hasLegacyHerdState(sourceRoot)

  if (!existsSync(dbPath)) {
    if (hasLegacyState) {
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion: null,
        requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'migration-required',
        migrationRequired: true,
        remediationCommand,
        hasLegacyState,
        error: 'Legacy agent runtime session state exists and no SQLite runtime-session database was found.',
      }
    }

    if (options.initializeFresh === false) {
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion: null,
        requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'migration-required',
        migrationRequired: true,
        remediationCommand,
        hasLegacyState,
        error: 'SQLite runtime-session database does not exist.',
      }
    }

    await mkdir(path.dirname(dbPath), { recursive: true })
    const db = openHerdSqliteDatabase(dbPath)
    try {
      applyHerdSqliteSchema(db)
      probeHerdSqliteWritable(db)
    } finally {
      db.close()
    }
    return {
      ready: true,
      dbPath,
      sourceRoot,
      schemaVersion: HERD_SQLITE_SCHEMA_VERSION,
      requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
      migrationStatus: 'fresh-initialized',
      migrationRequired: false,
      remediationCommand,
      hasLegacyState,
      error: null,
    }
  }

  try {
    const dbStat = await stat(dbPath)
    if (!dbStat.isFile()) {
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion: null,
        requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'corrupt',
        migrationRequired: true,
        remediationCommand: buildSqliteMigrationCommand({ sourceRoot, dbPath, replace: true }),
        hasLegacyState,
        error: 'Configured SQLite path exists but is not a regular file.',
      }
    }
  } catch (error) {
    return {
      ready: false,
      dbPath,
      sourceRoot,
      schemaVersion: null,
      requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
      migrationStatus: 'unwritable',
      migrationRequired: true,
      remediationCommand,
      hasLegacyState,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  let db: ReturnType<typeof openHerdSqliteDatabase> | null = null
  try {
    db = openHerdSqliteDatabase(dbPath)
    let versions = readAppliedHerdSchemaVersions(db)
    if (
      !isHerdSqliteSchemaCurrent(db)
      && canUpgradeHerdSqliteSchemaInPlace(db)
      && countNonArchivedRuntimeSessions(db) === 0
    ) {
      applyHerdSqliteSchema(db)
      versions = readAppliedHerdSchemaVersions(db)
    }
    const schemaVersion = versions.at(-1) ?? null
    if (!isHerdSqliteSchemaCurrent(db)) {
      const staleRemediationCommand = countNonArchivedRuntimeSessions(db) > 0
        ? buildSqliteMigrationCommand({ sourceRoot, dbPath, replace: true })
        : remediationCommand
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion,
        requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'stale',
        migrationRequired: true,
        remediationCommand: staleRemediationCommand,
        hasLegacyState,
        error: 'SQLite schema is missing or stale.',
      }
    }
    probeHerdSqliteWritable(db)
    return {
      ready: true,
      dbPath,
      sourceRoot,
      schemaVersion: HERD_SQLITE_SCHEMA_VERSION,
      requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
      migrationStatus: 'ready',
      migrationRequired: false,
      remediationCommand,
      hasLegacyState,
      error: null,
    }
  } catch (error) {
    return {
      ready: false,
      dbPath,
      sourceRoot,
      schemaVersion: null,
      requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
      migrationStatus: 'corrupt',
      migrationRequired: true,
      remediationCommand: buildSqliteMigrationCommand({ sourceRoot, dbPath, replace: true }),
      hasLegacyState,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    db?.close()
  }
}

export async function ensureHerdDatabaseReadyForBoot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HerdDatabaseReadiness> {
  const readiness = await inspectHerdDatabaseReadiness({
    env,
    initializeFresh: true,
  })
  if (!readiness.ready) {
    throw new HerdDatabaseNotReadyError(readiness)
  }
  return readiness
}
