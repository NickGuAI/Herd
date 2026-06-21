import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openHammurabiSqliteDatabase } from '../db/connection.js'
import {
  buildSqliteMigrationCommand,
  inspectHammurabiDatabaseReadiness,
} from '../db/readiness.js'
import { applyHammurabiSqliteSchema } from '../db/schema.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Hammurabi SQLite runtime-session readiness', () => {
  it('initializes a fresh current database when no legacy runtime state exists', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-fresh-')
    const dbPath = join(dataDir, 'hammurabi.sqlite')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: true,
      migrationStatus: 'fresh-initialized',
      migrationRequired: false,
      schemaVersion: '002_agent_runtime_session_payload',
    })
    await expect(access(dbPath)).resolves.toBeUndefined()
  })

  it('requires migration when legacy stream-sessions state exists without SQLite', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-legacy-')
    await mkdir(join(dataDir, 'agents'), { recursive: true })
    await writeFile(join(dataDir, 'agents', 'stream-sessions.json'), '{"sessions":[{"name":"legacy"}]}\n', 'utf8')
    const dbPath = join(dataDir, 'hammurabi.sqlite')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: false,
      migrationStatus: 'migration-required',
      migrationRequired: true,
      hasLegacyState: true,
    })
    expect(readiness.remediationCommand).toBe(buildSqliteMigrationCommand({
      sourceRoot: dataDir,
      dbPath,
    }))
    expect(readiness.remediationCommand).not.toContain('--commander-data-dir')
    expect(readiness.remediationCommand).not.toContain('--resume')
  })

  it('initializes fresh SQLite when the legacy stream-sessions store is empty', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-empty-legacy-')
    await mkdir(join(dataDir, 'agents'), { recursive: true })
    await writeFile(join(dataDir, 'agents', 'stream-sessions.json'), '{"sessions":[]}\n', 'utf8')
    const dbPath = join(dataDir, 'hammurabi.sqlite')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: true,
      migrationStatus: 'fresh-initialized',
      migrationRequired: false,
      hasLegacyState: false,
    })
    await expect(access(dbPath)).resolves.toBeUndefined()
  })

  it('still requires migration when the legacy stream-sessions store is malformed', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-malformed-legacy-')
    await mkdir(join(dataDir, 'agents'), { recursive: true })
    await writeFile(join(dataDir, 'agents', 'stream-sessions.json'), '{"sessions":[', 'utf8')
    const dbPath = join(dataDir, 'hammurabi.sqlite')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: false,
      migrationStatus: 'migration-required',
      migrationRequired: true,
      hasLegacyState: true,
    })
  })

  it('does not treat commander metadata alone as legacy runtime session state', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-commander-only-')
    await mkdir(join(dataDir, 'commander'), { recursive: true })
    await writeFile(join(dataDir, 'commander', 'sessions.json'), '{"sessions":[]}\n', 'utf8')
    const dbPath = join(dataDir, 'hammurabi.sqlite')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.hasLegacyState).toBe(false)
    await expect(access(dbPath)).resolves.toBeUndefined()
  })

  it('treats an existing database without the current schema marker as stale', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-stale-')
    const dbPath = join(dataDir, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    db.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY)')
    db.close()

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: false,
      migrationStatus: 'stale',
      migrationRequired: true,
    })
    expect(readiness.remediationCommand).toBe(buildSqliteMigrationCommand({
      sourceRoot: dataDir,
      dbPath,
    }))
    expect(readiness.remediationCommand).not.toContain('--resume')
  })

  it('emits replacement remediation for a partially populated stale runtime database', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-stale-populated-')
    const dbPath = join(dataDir, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      applyHammurabiSqliteSchema(db, '2026-06-20T01:00:00.000Z', { markApplied: false })
      db.prepare(`
        INSERT INTO agent_runtime_sessions (
          name,
          session_type,
          creator_kind,
          state,
          provider,
          provider_resume_json,
          cwd,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'partial-import',
        'commander',
        'human',
        'active',
        'codex',
        '{}',
        dataDir,
        '2026-06-20T01:01:00.000Z',
        '2026-06-20T01:01:00.000Z',
      )
    } finally {
      db.close()
    }

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: false,
      migrationStatus: 'stale',
      migrationRequired: true,
    })
    expect(readiness.remediationCommand).toBe(buildSqliteMigrationCommand({
      sourceRoot: dataDir,
      dbPath,
      replace: true,
    }))
    expect(readiness.remediationCommand).toContain('--replace')
  })

  it('upgrades an existing v1 runtime-session schema in place', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-upgrade-')
    const dbPath = join(dataDir, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      db.exec(`
        CREATE TABLE schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, applied_at)
          VALUES ('001_agent_runtime_sessions', '2026-06-20T01:00:00.000Z');
        CREATE TABLE agent_runtime_sessions (
          name TEXT PRIMARY KEY,
          session_type TEXT NOT NULL,
          creator_kind TEXT NOT NULL,
          creator_id TEXT,
          conversation_id TEXT,
          spawned_by TEXT,
          transport_type TEXT NOT NULL DEFAULT 'stream',
          machine_id TEXT NOT NULL DEFAULT 'local',
          state TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_resume_json TEXT NOT NULL,
          cwd TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );
      `)
    } finally {
      db.close()
    }

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: true,
      migrationStatus: 'ready',
      migrationRequired: false,
      schemaVersion: '002_agent_runtime_session_payload',
    })

    const verifyDb = openHammurabiSqliteDatabase(dbPath)
    try {
      const columns = verifyDb.prepare('PRAGMA table_info(agent_runtime_sessions)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toContain('runtime_state_json')
    } finally {
      verifyDb.close()
    }
  })

  it('requires replacement for populated v1 runtime-session databases', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-v1-populated-')
    const dbPath = join(dataDir, 'hammurabi.sqlite')
    const db = openHammurabiSqliteDatabase(dbPath)
    try {
      db.exec(`
        CREATE TABLE schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, applied_at)
          VALUES ('001_agent_runtime_sessions', '2026-06-20T01:00:00.000Z');
        CREATE TABLE agent_runtime_sessions (
          name TEXT PRIMARY KEY,
          session_type TEXT NOT NULL,
          creator_kind TEXT NOT NULL,
          creator_id TEXT,
          conversation_id TEXT,
          spawned_by TEXT,
          transport_type TEXT NOT NULL DEFAULT 'stream',
          machine_id TEXT NOT NULL DEFAULT 'local',
          state TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_resume_json TEXT NOT NULL,
          cwd TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );
        INSERT INTO agent_runtime_sessions (
          name,
          session_type,
          creator_kind,
          state,
          provider,
          provider_resume_json,
          cwd,
          created_at,
          updated_at
        ) VALUES (
          'v1-runtime',
          'commander',
          'human',
          'active',
          'codex',
          '{"providerId":"codex","threadId":"v1-thread"}',
          '/repo',
          '2026-06-20T01:00:00.000Z',
          '2026-06-20T01:00:00.000Z'
        );
      `)
    } finally {
      db.close()
    }

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: false,
      migrationStatus: 'stale',
      migrationRequired: true,
      schemaVersion: '001_agent_runtime_sessions',
    })
    expect(readiness.remediationCommand).toBe(buildSqliteMigrationCommand({
      sourceRoot: dataDir,
      dbPath,
      replace: true,
    }))
  })

  it('emits replacement remediation for a corrupt existing database', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-corrupt-')
    const dbPath = join(dataDir, 'hammurabi.sqlite')
    await writeFile(dbPath, 'not a sqlite database', 'utf8')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      dbPath,
      initializeFresh: true,
    })

    expect(readiness).toMatchObject({
      ready: false,
      migrationStatus: 'corrupt',
      migrationRequired: true,
    })
    expect(readiness.remediationCommand).toBe(buildSqliteMigrationCommand({
      sourceRoot: dataDir,
      dbPath,
      replace: true,
    }))
    expect(readiness.remediationCommand).toContain('--replace')
  })

  it('honors HAMMURABI_DB_PATH when no explicit db path is supplied', async () => {
    const dataDir = await makeTempDir('hammurabi-sqlite-ready-env-')
    const dbPath = join(dataDir, 'custom.sqlite')

    const readiness = await inspectHammurabiDatabaseReadiness({
      sourceRoot: dataDir,
      env: {
        ...process.env,
        HAMMURABI_DATA_DIR: dataDir,
        HAMMURABI_DB_PATH: dbPath,
      },
      initializeFresh: true,
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.dbPath).toBe(dbPath)
    await expect(access(dbPath)).resolves.toBeUndefined()
  })
})
