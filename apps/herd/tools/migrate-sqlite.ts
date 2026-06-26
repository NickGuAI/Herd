import path from 'node:path'
import {
  defaultSqliteMigrationOptions,
  runSqliteMigration,
} from '../server/db/migration.js'

interface ParsedArgs {
  sourceRoot: string
  dbPath: string
  backup: boolean
  replace: boolean
}

function usage(): string {
  return [
    'Usage: pnpm --filter herd run migrate:sqlite -- --source-root <dir> --db <file> [--backup|--backup=false] [--replace]',
    '',
    'Examples:',
    '  pnpm --filter herd run migrate:sqlite -- --source-root ~/.herd --db ~/.herd/herd.sqlite --backup',
  ].join('\n')
}

function expandTilde(value: string): string {
  if (value === '~' || value.startsWith('~/')) {
    return path.join(process.env.HOME || '.', value.slice(2))
  }
  return value
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const defaults = defaultSqliteMigrationOptions()
  const parsed: ParsedArgs = {
    sourceRoot: defaults.sourceRoot,
    dbPath: defaults.dbPath,
    backup: true,
    replace: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    const next = () => {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value`)
      }
      index += 1
      return value
    }

    if (arg === '--source-root') {
      parsed.sourceRoot = path.resolve(expandTilde(next()))
    } else if (arg.startsWith('--source-root=')) {
      parsed.sourceRoot = path.resolve(expandTilde(arg.slice('--source-root='.length)))
    } else if (arg === '--db') {
      parsed.dbPath = path.resolve(expandTilde(next()))
    } else if (arg.startsWith('--db=')) {
      parsed.dbPath = path.resolve(expandTilde(arg.slice('--db='.length)))
    } else if (arg === '--backup') {
      parsed.backup = true
    } else if (arg === '--backup=false') {
      parsed.backup = false
    } else if (arg === '--replace') {
      parsed.replace = true
    } else if (arg === '-h' || arg === '--help') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

try {
  const args = parseArgs(process.argv.slice(2))
  const result = await runSqliteMigration({
    sourceRoot: args.sourceRoot,
    dbPath: args.dbPath,
    backup: args.backup,
    replace: args.replace,
  })
  console.log(JSON.stringify({
    ok: true,
    runId: result.runId,
    dbPath: result.dbPath,
    sourceRoot: result.sourceRoot,
    stats: result.stats,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
