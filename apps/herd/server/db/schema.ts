import type { DatabaseSync } from 'node:sqlite'

const AGENT_RUNTIME_SESSIONS_V1_SCHEMA_VERSION = '001_agent_runtime_sessions'
export const HERD_SQLITE_SCHEMA_VERSION = '002_agent_runtime_session_payload'

const AGENT_RUNTIME_SESSION_REQUIRED_COLUMNS = new Set([
  'runtime_state_json',
])

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
  name TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('commander', 'worker', 'cron', 'sentinel', 'automation')),
  creator_kind TEXT NOT NULL CHECK (creator_kind IN ('human', 'commander', 'cron', 'sentinel', 'automation')),
  creator_id TEXT,
  conversation_id TEXT,
  spawned_by TEXT,
  transport_type TEXT NOT NULL DEFAULT 'stream' CHECK (transport_type IN ('stream', 'pty', 'external')),
  machine_id TEXT NOT NULL DEFAULT 'local',
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'archived')),
  provider TEXT NOT NULL,
  provider_resume_json TEXT NOT NULL,
  runtime_state_json TEXT NOT NULL DEFAULT '{}',
  cwd TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS agent_runtime_sessions_state_idx
  ON agent_runtime_sessions(state);

CREATE INDEX IF NOT EXISTS agent_runtime_sessions_owner_idx
  ON agent_runtime_sessions(session_type, creator_kind, creator_id);

CREATE INDEX IF NOT EXISTS agent_runtime_sessions_conversation_idx
  ON agent_runtime_sessions(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runtime_sessions_machine_idx
  ON agent_runtime_sessions(machine_id);
`

function readAgentRuntimeSessionColumns(db: DatabaseSync): Set<string> {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_runtime_sessions'",
  ).get()
  if (!table) {
    return new Set()
  }

  const rows = db.prepare('PRAGMA table_info(agent_runtime_sessions)').all() as Array<{ name: unknown }>
  return new Set(
    rows
      .map((row) => typeof row.name === 'string' ? row.name : null)
      .filter((name): name is string => name !== null),
  )
}

function ensureAgentRuntimeSessionPayloadColumns(db: DatabaseSync): void {
  const columns = readAgentRuntimeSessionColumns(db)
  if (columns.size === 0) {
    return
  }
  if (!columns.has('runtime_state_json')) {
    db.exec("ALTER TABLE agent_runtime_sessions ADD COLUMN runtime_state_json TEXT NOT NULL DEFAULT '{}'")
  }
}

export function hasCurrentHerdSqliteSchemaColumns(db: DatabaseSync): boolean {
  const columns = readAgentRuntimeSessionColumns(db)
  if (columns.size === 0) {
    return false
  }
  for (const column of AGENT_RUNTIME_SESSION_REQUIRED_COLUMNS) {
    if (!columns.has(column)) {
      return false
    }
  }
  return true
}

export function applyHerdSqliteSchema(
  db: DatabaseSync,
  appliedAt: string = new Date().toISOString(),
  options: { markApplied?: boolean } = {},
): void {
  db.exec(SCHEMA_SQL)
  ensureAgentRuntimeSessionPayloadColumns(db)
  if (options.markApplied === false) {
    return
  }
  db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  ).run(HERD_SQLITE_SCHEMA_VERSION, appliedAt)
}

export function readAppliedHerdSchemaVersions(db: DatabaseSync): string[] {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get()
  if (!table) {
    return []
  }

  const rows = db.prepare(
    'SELECT version FROM schema_migrations ORDER BY applied_at ASC, version ASC',
  ).all() as Array<{ version: unknown }>
  return rows
    .map((row) => typeof row.version === 'string' ? row.version : null)
    .filter((version): version is string => version !== null)
}

export function isHerdSqliteSchemaCurrent(db: DatabaseSync): boolean {
  return readAppliedHerdSchemaVersions(db).includes(HERD_SQLITE_SCHEMA_VERSION)
    && hasCurrentHerdSqliteSchemaColumns(db)
}

export function canUpgradeHerdSqliteSchemaInPlace(db: DatabaseSync): boolean {
  const versions = readAppliedHerdSchemaVersions(db)
  return versions.includes(AGENT_RUNTIME_SESSIONS_V1_SCHEMA_VERSION)
    || versions.includes(HERD_SQLITE_SCHEMA_VERSION)
}
