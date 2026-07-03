import path from 'node:path'
import {
  runProviderSecretsMigration,
} from './provider-secrets-migration.js'

interface ParsedArgs {
  legacyFilePath?: string
  legacyKeyFilePath?: string
  providerFilePath?: string
  providerKeyFilePath?: string
}

function usage(): string {
  return [
    'Usage: pnpm --filter herd run migrate:provider-secrets [-- --legacy-file <file> --legacy-key <file> --provider-file <file> --provider-key <file>]',
    '',
    'Moves old transcription secret files into the canonical provider secret files.',
    'The migration refuses to overwrite existing provider secret files.',
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

    if (arg === '--legacy-file') {
      parsed.legacyFilePath = parsePathArg(next())
    } else if (arg.startsWith('--legacy-file=')) {
      parsed.legacyFilePath = parsePathArg(arg.slice('--legacy-file='.length))
    } else if (arg === '--legacy-key') {
      parsed.legacyKeyFilePath = parsePathArg(next())
    } else if (arg.startsWith('--legacy-key=')) {
      parsed.legacyKeyFilePath = parsePathArg(arg.slice('--legacy-key='.length))
    } else if (arg === '--provider-file') {
      parsed.providerFilePath = parsePathArg(next())
    } else if (arg.startsWith('--provider-file=')) {
      parsed.providerFilePath = parsePathArg(arg.slice('--provider-file='.length))
    } else if (arg === '--provider-key') {
      parsed.providerKeyFilePath = parsePathArg(next())
    } else if (arg.startsWith('--provider-key=')) {
      parsed.providerKeyFilePath = parsePathArg(arg.slice('--provider-key='.length))
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
  const result = await runProviderSecretsMigration(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify({
    ok: true,
    ...result,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
