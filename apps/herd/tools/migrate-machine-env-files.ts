import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encryptMachineEnvFile } from '../modules/agents/machine-credentials.js'
import {
  createMachineRegistryStore,
  defaultMachineRegistryStorePath,
  isRemoteMachine,
} from '../modules/agents/machines.js'
import type { MachineConfig } from '../modules/agents/types.js'

export interface MachineEnvFileMigrationOptions {
  machinesFile: string
  dryRun: boolean
}

export interface MachineEnvFileMigrationResult {
  machineId: string
  envFile: string
  migratedEnvFile?: string
  status: 'migrated' | 'would-migrate' | 'skipped'
  reason?: string
}

function usage(): string {
  return [
    'Usage: pnpm --filter herd run migrate:machine-env-files [-- --machines-file <file>] [--dry-run]',
    '',
    'Encrypts plaintext local machine env files and updates machines.json once.',
    'Production runtime does not run this migration automatically.',
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

function parseArgs(argv: readonly string[]): MachineEnvFileMigrationOptions {
  const parsed: MachineEnvFileMigrationOptions = {
    machinesFile: defaultMachineRegistryStorePath(),
    dryRun: false,
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

    if (arg === '--machines-file') {
      parsed.machinesFile = parsePathArg(next())
    } else if (arg.startsWith('--machines-file=')) {
      parsed.machinesFile = parsePathArg(arg.slice('--machines-file='.length))
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '-h' || arg === '--help') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

async function plaintextFileExists(envFile: string): Promise<boolean> {
  try {
    const stats = await stat(envFile)
    return stats.isFile()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false
    }
    throw error
  }
}

export async function runMachineEnvFilesMigration(args: MachineEnvFileMigrationOptions): Promise<{
  changed: boolean
  machinesFile: string
  results: MachineEnvFileMigrationResult[]
}> {
  const registry = createMachineRegistryStore(args.machinesFile)
  const machines = await registry.readMachineRegistry()
  const nextMachines: MachineConfig[] = []
  const results: MachineEnvFileMigrationResult[] = []
  let changed = false

  for (const machine of machines) {
    const envFile = machine.envFile?.trim()
    if (!envFile) {
      nextMachines.push(machine)
      continue
    }
    if (envFile.endsWith('.enc')) {
      nextMachines.push(machine)
      results.push({
        machineId: machine.id,
        envFile,
        status: 'skipped',
        reason: 'already encrypted',
      })
      continue
    }
    if (isRemoteMachine(machine)) {
      nextMachines.push(machine)
      results.push({
        machineId: machine.id,
        envFile,
        status: 'skipped',
        reason: 'remote machine env file is sourced on the remote host',
      })
      continue
    }
    if (!(await plaintextFileExists(envFile))) {
      nextMachines.push(machine)
      results.push({
        machineId: machine.id,
        envFile,
        status: 'skipped',
        reason: 'plaintext env file not found',
      })
      continue
    }

    if (args.dryRun) {
      nextMachines.push(machine)
      results.push({
        machineId: machine.id,
        envFile,
        status: 'would-migrate',
      })
      continue
    }

    const migratedEnvFile = await encryptMachineEnvFile(machine, envFile)
    if (migratedEnvFile !== envFile) {
      nextMachines.push({ ...machine, envFile: migratedEnvFile })
      results.push({
        machineId: machine.id,
        envFile,
        migratedEnvFile,
        status: 'migrated',
      })
      changed = true
      continue
    }

    nextMachines.push(machine)
    results.push({
      machineId: machine.id,
      envFile,
      status: 'skipped',
      reason: 'file did not contain parseable env assignments',
    })
  }

  if (changed) {
    await registry.writeMachineRegistry(nextMachines)
  }

  return {
    changed,
    machinesFile: args.machinesFile,
    results,
  }
}

const isCliEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isCliEntrypoint) {
  try {
    const result = await runMachineEnvFilesMigration(parseArgs(process.argv.slice(2)))
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    process.exit(1)
  }
}
