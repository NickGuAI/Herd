import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { resolveHammurabiDataDir } from '../../modules/data-dir.js'

export const HAMMURABI_DB_PATH_ENV = 'HAMMURABI_DB_PATH'

const nodeSqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

export function resolveHammurabiDbPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[HAMMURABI_DB_PATH_ENV]?.trim()
  if (configured) {
    return path.resolve(configured.replace(/^~(?=$|\/)/u, homedir()))
  }
  return path.join(resolveHammurabiDataDir(env), 'hammurabi.sqlite')
}

export function openHammurabiSqliteDatabase(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new nodeSqlite.DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA foreign_keys=ON')
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

export function probeHammurabiSqliteWritable(db: DatabaseSync): void {
  const timestamp = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS hammurabi_write_probe (id INTEGER PRIMARY KEY CHECK (id = 1), updated_at TEXT NOT NULL)',
    )
    db.prepare(
      'INSERT OR REPLACE INTO temp.hammurabi_write_probe (id, updated_at) VALUES (1, ?)',
    ).run(timestamp)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
