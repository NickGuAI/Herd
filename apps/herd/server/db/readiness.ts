import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveHerdDataDir } from '../../modules/data-dir.js'
import {
  applyHerdSqliteSchema,
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
  | 'missing'
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
  error: string | null
}

export class HerdDatabaseNotReadyError extends Error {
  constructor(readonly readiness: HerdDatabaseReadiness) {
    super(formatDatabaseNotReadyMessage(readiness))
    this.name = 'HerdDatabaseNotReadyError'
  }
}

function formatDatabaseNotReadyMessage(readiness: HerdDatabaseReadiness): string {
  const detail = readiness.error ? `\n${readiness.error}` : ''
  return [
    '[database] Herd SQLite runtime-session store is not ready.',
    `status: ${readiness.migrationStatus}`,
    `db: ${readiness.dbPath}`,
    `required schema: ${readiness.requiredSchemaVersion}`,
    detail,
  ].filter(Boolean).join('\n')
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

  if (!existsSync(dbPath)) {
    if (options.initializeFresh === false) {
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion: null,
        requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'missing',
        error: 'SQLite runtime-session database does not exist. Run db:ready without --no-init or start Herd to initialize the current database.',
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
      error: error instanceof Error ? error.message : String(error),
    }
  }

  let db: ReturnType<typeof openHerdSqliteDatabase> | null = null
  try {
    db = openHerdSqliteDatabase(dbPath)
    const versions = readAppliedHerdSchemaVersions(db)
    const schemaVersion = versions.length > 0 ? versions[versions.length - 1] : null
    if (!isHerdSqliteSchemaCurrent(db)) {
      return {
        ready: false,
        dbPath,
        sourceRoot,
        schemaVersion,
        requiredSchemaVersion: HERD_SQLITE_SCHEMA_VERSION,
        migrationStatus: 'stale',
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
