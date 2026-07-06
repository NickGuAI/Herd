import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  defaultConfigPath,
  normalizeEndpoint,
  readHerdConfig,
  type HerdConfig,
} from './config.js'
import {
  APP_PATH_FILE,
  loadDotenv,
  readAppPathFileValue,
  resolveAppDir,
  resolveAppPathFileCandidates,
  resolveBootstrapKeyFile,
} from './up.js'
import {
  formatStatusLine,
  printHervaldBrand,
} from './terminal-style.js'

export type DoctorState = 'pass' | 'warn' | 'fail'

export interface DoctorCheck {
  label: string
  state: DoctorState
  detail: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  onboardingUrl: string | null
  config: HerdConfig | null
}

export interface DoctorOptions {
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
  configPath?: string
  runCommand?: DoctorCommandRunner
}

interface DoctorCommandResult {
  status?: number | null
  stdout?: string | Buffer | null
  stderr?: string | Buffer | null
  error?: Error
}

type DoctorCommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: Record<string, string>
    encoding: 'utf8'
  },
) => DoctorCommandResult

function stateLabel(state: DoctorState): string {
  return state === 'pass' ? 'ready' : state === 'warn' ? 'needs attention' : 'missing'
}

function localMachineEnvFile(env: NodeJS.ProcessEnv): string {
  return env.HERD_LOCAL_MACHINE_ENV_FILE?.trim() || path.join(homedir(), '.herd-env')
}

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/u, homedir())
}

function resolveDoctorDbPath(env: NodeJS.ProcessEnv, dataDir: string): string {
  const configured = env.HERD_DB_PATH?.trim()
  return path.resolve(configured ? expandHome(configured) : path.join(dataDir, 'herd.sqlite'))
}

function commandOutputToString(output: string | Buffer | null | undefined): string {
  if (!output) {
    return ''
  }
  return typeof output === 'string' ? output : output.toString('utf8')
}

function oneLineOutput(output: string): string {
  return output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' · ')
}

function readAppPathFile(env: NodeJS.ProcessEnv): string | null {
  for (const candidate of resolveAppPathFileCandidates(env)) {
    const value = readAppPathFileValue(candidate)
    if (value) {
      return value
    }
  }
  return null
}

function buildAuthHeaders(config: HerdConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.apiKey}`,
  }
}

async function fetchOnboardingStatus(
  config: HerdConfig,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; summary: string }> {
  const url = new URL('/api/onboarding/status', `${normalizeEndpoint(config.endpoint)}/`).toString()
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: buildAuthHeaders(config),
    })
    if (!response.ok) {
      return { ok: false, summary: `server returned ${response.status}` }
    }
    const raw = await response.text()
    if (raw.trim().length === 0) {
      return {
        ok: false,
        summary: `empty response from ${url}; run herd up --dev after configuring App path`,
      }
    }
    const payload = JSON.parse(raw) as {
      currentStepId?: unknown
      providers?: Array<{ label?: unknown; state?: unknown }>
      machines?: Array<{ id?: unknown; state?: unknown }>
    }
    const readyProviders = Array.isArray(payload.providers)
      ? payload.providers.filter((provider) => provider.state === 'ready').length
      : 0
    const readyMachines = Array.isArray(payload.machines)
      ? payload.machines.filter((machine) => machine.state === 'ready').length
      : 0
    return {
      ok: true,
      summary: `step=${String(payload.currentStepId ?? 'unknown')} · providers=${readyProviders} ready · machines=${readyMachines} ready`,
    }
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error
        ? `${error.message}; run herd up --dev after configuring App path`
        : 'server unreachable; run herd up --dev after configuring App path',
    }
  }
}

function buildSqliteRuntimeSessionsCheck(input: {
  appDir: string | null
  dataDir: string
  dbPath: string
  env: NodeJS.ProcessEnv
  runCommand: DoctorCommandRunner
}): DoctorCheck {
  const { appDir, dataDir, dbPath, env, runCommand } = input
  const baseDetail = `data=${dataDir} · db=${dbPath}`
  if (!appDir || !existsSync(path.join(appDir, 'package.json'))) {
    return {
      label: 'SQLite runtime sessions',
      state: 'fail',
      detail: `${baseDetail} · app path unavailable; cannot run pnpm run db:ready`,
    }
  }

  const result = runCommand('pnpm', [
    'run',
    'db:ready',
    '--',
    '--source-root',
    dataDir,
    '--db',
    dbPath,
    '--no-init',
  ], {
    cwd: appDir,
    env: {
      ...process.env,
      ...env,
      HERD_APP_DIR: appDir,
      HERD_DATA_DIR: dataDir,
      HERD_DB_PATH: dbPath,
    } as Record<string, string>,
    encoding: 'utf8',
  })

  if (result.error) {
    return {
      label: 'SQLite runtime sessions',
      state: 'fail',
      detail: `${baseDetail} · db:ready could not start: ${result.error.message}`,
    }
  }

  const output = oneLineOutput([
    commandOutputToString(result.stdout),
    commandOutputToString(result.stderr),
  ].filter(Boolean).join('\n'))
  const outputDetail = output ? ` · ${output}` : ''
  if (result.status === 0) {
    return {
      label: 'SQLite runtime sessions',
      state: 'pass',
      detail: `${baseDetail} · required schema=current${outputDetail}`,
    }
  }

  return {
    label: 'SQLite runtime sessions',
    state: 'fail',
    detail: `${baseDetail} · required schema=see db:ready output${outputDetail}`,
  }
}

export async function buildDoctorReport(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env
  const configPath = options.configPath ?? defaultConfigPath()
  const fetchImpl = options.fetchImpl ?? fetch
  const runCommand = options.runCommand ?? ((command, args, commandOptions) => spawnSync(command, args, commandOptions))
  const checks: DoctorCheck[] = []
  const config = await readHerdConfig(configPath)
  const appDir = resolveAppDir(env)
  const appEnv = appDir && existsSync(path.join(appDir, 'package.json'))
    ? loadDotenv(appDir)
    : {}
  const effectiveEnv = { ...env, ...appEnv }
  const appPathFileValue = readAppPathFile(env)
  const appPathFileCandidates = resolveAppPathFileCandidates(env)
  const dataDir = path.resolve(expandHome(effectiveEnv.HERD_DATA_DIR?.trim() || path.join(homedir(), '.herd')))
  const dbPath = resolveDoctorDbPath(effectiveEnv, dataDir)
  const envFile = localMachineEnvFile(effectiveEnv)

  checks.push({
    label: 'CLI config',
    state: config ? 'pass' : 'warn',
    detail: config ? configPath : `not configured at ${configPath}; run herd onboard if this CLI should call a remote server`,
  })

  checks.push({
    label: 'App path',
    state: appDir && existsSync(path.join(appDir, 'package.json')) ? 'pass' : 'fail',
    detail: appDir ?? appPathFileValue ?? `missing ${appPathFileCandidates.join(' or ')}; set HERD_APP_DIR or run apps/herd/install.sh`,
  })

  checks.push({
    label: 'Data directory',
    state: existsSync(dataDir) ? 'pass' : 'warn',
    detail: dataDir,
  })

  checks.push(buildSqliteRuntimeSessionsCheck({
    appDir,
    dataDir,
    dbPath,
    env: effectiveEnv,
    runCommand,
  }))

  const bootstrapKeyFile = resolveBootstrapKeyFile(effectiveEnv)
  checks.push({
    label: 'Bootstrap key',
    state: existsSync(bootstrapKeyFile) ? 'pass' : 'warn',
    detail: bootstrapKeyFile,
  })

  checks.push({
    label: 'Local machine env',
    state: existsSync(envFile) ? 'pass' : 'warn',
    detail: existsSync(envFile) ? envFile : `${envFile}; run apps/herd/install.sh or set HERD_LOCAL_MACHINE_ENV_FILE`,
  })

  if (config) {
    const serverStatus = await fetchOnboardingStatus(config, fetchImpl)
    checks.push({
      label: 'Browser onboarding API',
      state: serverStatus.ok ? 'pass' : 'warn',
      detail: serverStatus.summary,
    })
  }

  return {
    checks,
    onboardingUrl: config ? `${normalizeEndpoint(config.endpoint)}/welcome` : null,
    config,
  }
}

export function printDoctorReport(
  report: DoctorReport,
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
): void {
  printHervaldBrand('Herd Doctor', write)

  for (const check of report.checks) {
    write(`${formatStatusLine(check.state, check.label, stateLabel(check.state), check.detail)}\n`)
  }

  write('\n')
  write('Next\n')
  if (report.onboardingUrl) {
    write(`  1. Open ${report.onboardingUrl}\n`)
    write('  2. Complete the browser onboarding guide\n')
  } else {
    write('  1. Run herd onboard if this CLI should connect to a server\n')
    write('  2. Start the local app with herd up\n')
  }
  write('  3. Re-run herd doctor after provider authentication\n')
}

export async function runDoctorCli(args: readonly string[] = []): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: herd doctor\n')
    process.stdout.write('\n')
    process.stdout.write('  Print terminal readiness for Herd first-run onboarding.\n')
    return 0
  }

  const report = await buildDoctorReport()
  printDoctorReport(report)
  return report.checks.some((check) => check.state === 'fail') ? 1 : 0
}
