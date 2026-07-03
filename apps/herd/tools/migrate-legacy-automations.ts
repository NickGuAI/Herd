import path from 'node:path'
import { migrateLegacyAutomations } from './legacy-automations-migration.js'

interface ParsedArgs {
  automationsDir?: string
  commanderDataDir?: string
}

function usage(): string {
  return [
    'Usage: pnpm --filter herd run migrate:legacy-automations [-- --automations-dir <dir> --commander-data-dir <dir>]',
    '',
    'Imports old cron/sentinel automation files into the canonical automations directory.',
    'This is a one-off operator tool; the server does not run this migration at startup.',
  ].join('\n')
}

function expandTilde(value: string): string {
  if (value === '~' || value.startsWith('~/')) {
    return path.join(process.env.HOME || '.', value.slice(2))
  }
  return value
}

function parsePathArg(value: string): string {
  return path.resolve(expandTilde(value))
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {}

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

    if (arg === '--automations-dir') {
      parsed.automationsDir = parsePathArg(next())
    } else if (arg.startsWith('--automations-dir=')) {
      parsed.automationsDir = parsePathArg(arg.slice('--automations-dir='.length))
    } else if (arg === '--commander-data-dir') {
      parsed.commanderDataDir = parsePathArg(next())
    } else if (arg.startsWith('--commander-data-dir=')) {
      parsed.commanderDataDir = parsePathArg(arg.slice('--commander-data-dir='.length))
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
  const result = await migrateLegacyAutomations(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify({
    ok: true,
    ...result,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
