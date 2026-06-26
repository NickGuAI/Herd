import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { resolveHerdDataDir } from '../../modules/data-dir.js'

export const HERD_DB_PATH_ENV = 'HERD_DB_PATH'

const nodeSqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

export function resolveHerdDbPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[HERD_DB_PATH_ENV]?.trim()
  if (configured) {
    return path.resolve(configured.replace(/^~(?=$|\/)/u, homedir()))
  }
  return path.join(resolveHerdDataDir(env), 'herd.sqlite')
}

export function openHerdSqliteDatabase(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new nodeSqlite.DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA foreign_keys=ON')
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

export function probeHerdSqliteWritable(db: DatabaseSync): void {
  const timestamp = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS herd_write_probe (id INTEGER PRIMARY KEY CHECK (id = 1), updated_at TEXT NOT NULL)',
    )
    db.prepare(
      'INSERT OR REPLACE INTO temp.herd_write_probe (id, updated_at) VALUES (1, ?)',
    ).run(timestamp)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
