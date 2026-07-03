#!/usr/bin/env tsx
import { inspectHerdDatabaseReadiness } from '../server/db/readiness.js'

function usage(): string {
  return [
    'Usage: pnpm --filter herd run db:ready -- [--source-root <dir>] [--db <file>] [--no-init]',
    '',
    'Checks the Herd SQLite runtime-session database. Fresh installs initialize by default.',
  ].join('\n')
}

function parseArgs(argv: string[]): {
  sourceRoot?: string
  dbPath?: string
  initializeFresh: boolean
} {
  const parsed: {
    sourceRoot?: string
    dbPath?: string
    initializeFresh: boolean
  } = {
    initializeFresh: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--source-root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--source-root requires a value')
      parsed.sourceRoot = value
      index += 1
      continue
    }
    if (arg === '--db') {
      const value = argv[index + 1]
      if (!value) throw new Error('--db requires a value')
      parsed.dbPath = value
      index += 1
      continue
    }
    if (arg === '--no-init') {
      parsed.initializeFresh = false
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return parsed
}

try {
  const args = parseArgs(process.argv.slice(2))
  const readiness = await inspectHerdDatabaseReadiness({
    sourceRoot: args.sourceRoot,
    dbPath: args.dbPath,
    initializeFresh: args.initializeFresh,
  })
  if (!readiness.ready) {
    console.error('[db:ready] SQLite runtime-session database is not ready.')
    console.error(`status: ${readiness.migrationStatus}`)
    console.error(`db: ${readiness.dbPath}`)
    console.error(`required schema: ${readiness.requiredSchemaVersion}`)
    if (readiness.error) {
      console.error(readiness.error)
    }
    process.exit(1)
  }
  console.log(`[db:ready] SQLite runtime-session database ready at ${readiness.dbPath} (${readiness.migrationStatus})`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
