import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveHammurabiDataDir } from '../../modules/data-dir.js'
import {
  applyHammurabiSqliteSchema,
  canUpgradeHammurabiSqliteSchemaInPlace,
  HAMMURABI_SQLITE_SCHEMA_VERSION,
  isHammurabiSqliteSchemaCurrent,
  readAppliedHammurabiSchemaVersions,
} from './schema.js'
import {
  openHammurabiSqliteDatabase,
  probeHammurabiSqliteWritable,
  resolveHammurabiDbPath,
} from './connection.js'

export type HammurabiDatabaseMigrationStatus =
  | 'ready'
  | 'fresh-initialized'
  | 'migration-required'
  | 'stale'
  | 'corrupt'
  | 'unwritable'

export interface HammurabiDatabaseReadiness {
  ready: boolean
  dbPath: string
  sourceRoot: string
  schemaVersion: string | null
  requiredSchemaVersion: string
  migrationStatus: HammurabiDatabaseMigrationStatus
  migrationRequired: boolean
  remediationCommand: string
  hasLegacyState: boolean
  error: string | null
}

export class HammurabiDatabaseNotReadyError extends Error {
  constructor(readonly readiness: HammurabiDatabaseReadiness) {
    super(formatDatabaseNotReadyMessage(readiness))
    this.name = 'HammurabiDatabaseNotReadyError'
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
    'pnpm --filter hammurabi run migrate:sqlite --',
    '--source-root',
    quoteShell(input.sourceRoot),
    '--db',
    quoteShell(input.dbPath),
    input.backup === false ? '--backup=false' : '--backup',
    ...(input.replace ? ['--replace'] : []),
  ].join(' ')
}

function formatDatabaseNotReadyMessage(readiness: HammurabiDatabaseReadiness): string {
  const detail = readiness.error ? `\n${readiness.error}` : ''
  return [
    '[database] Hammurabi SQLite runtime-session store is not ready.',
    `status: ${readiness.migrationStatus}`,
    `db: ${readiness.dbPath}`,
    `required schema: ${readiness.requiredSchemaVersion}`,
    `remediation: ${readiness.remediationCommand}`,
    detail,
  ].filter(Boolean).join('\n')
}

export async function hasLegacyHammurabiState(sourceRoot: string): Promise<boolean> {
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

function countNonArchivedRuntimeSessions(db: ReturnType<typeof openHammurabiSqliteDatabase>): number {
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

export async function inspectHammurabiDatabaseReadiness(options: {
  env?: NodeJS.ProcessEnv
  sourceRoot?: string
  dbPath?: string
  initializeFresh?: boolean
} = {}): Promise<HammurabiDatabaseReadiness> {
  const env = options.env ?? process.env
  const sourceRoot = path.resolve(options.sourceRoot ?? resolveHammurabiDataDir(env))
  const dbPath = path.resolve(options.dbPath ?? resolveHammurabiDbPath(env))
  const remediationCommand = buildSqliteMigrationCommand({ sourceRoot, dbPath })
  const hasLegacyState = await hasLegacyHammurabiState(sourceRoot)

  if (!existsSync(dbPath)) {
    if (hasLegacyState) {
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion: null,
        requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
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
        requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'migration-required',
        migrationRequired: true,
        remediationCommand,
        hasLegacyState,
        error: 'SQLite runtime-session database does not exist.',
      }
    }

    await mkdir(path.dirname(dbPath), { recursive: true })
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      applyHammurabiSqliteSchema(db)
      probeHammurabiSqliteWritable(db)
    } finally {
      db.close()
    }
    return {
      ready: true,
      dbPath,
      sourceRoot,
      schemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
      requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
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
        requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
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
      requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
      migrationStatus: 'unwritable',
      migrationRequired: true,
      remediationCommand,
      hasLegacyState,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  let db: ReturnType<typeof openHammurabiSqliteDatabase> | null = null
  try {
    db = openHammurabiSqliteDatabase(dbPath)
    let versions = readAppliedHammurabiSchemaVersions(db)
    if (
      !isHammurabiSqliteSchemaCurrent(db)
      && canUpgradeHammurabiSqliteSchemaInPlace(db)
      && countNonArchivedRuntimeSessions(db) === 0
    ) {
      applyHammurabiSqliteSchema(db)
      versions = readAppliedHammurabiSchemaVersions(db)
    }
    const schemaVersion = versions.at(-1) ?? null
    if (!isHammurabiSqliteSchemaCurrent(db)) {
      const staleRemediationCommand = countNonArchivedRuntimeSessions(db) > 0
        ? buildSqliteMigrationCommand({ sourceRoot, dbPath, replace: true })
        : remediationCommand
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion,
        requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'stale',
        migrationRequired: true,
        remediationCommand: staleRemediationCommand,
        hasLegacyState,
        error: 'SQLite schema is missing or stale.',
      }
    }
    probeHammurabiSqliteWritable(db)
    return {
      ready: true,
      dbPath,
      sourceRoot,
      schemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
      requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
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
      requiredSchemaVersion: HAMMURABI_SQLITE_SCHEMA_VERSION,
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

export async function ensureHammurabiDatabaseReadyForBoot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HammurabiDatabaseReadiness> {
  const readiness = await inspectHammurabiDatabaseReadiness({
    env,
    initializeFresh: true,
  })
  if (!readiness.ready) {
    throw new HammurabiDatabaseNotReadyError(readiness)
  }
  return readiness
}
