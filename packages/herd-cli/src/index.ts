import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HerdConfig, normalizeEndpoint, readHerdConfig } from './config.js'
import { readJsonResponse } from './http-json.js'
import { runCli as runOnboardCli } from './onboard.js'
import { runMachinesCli } from './machines.js'
import { runQuestsCli } from './quests.js'
import { runWorkersCli } from './workers.js'
import { runCommanderCli } from './commander.js'
import { runAutomationCli } from './automation.js'
import { runMemoryCli } from './memory.js'
import { runSessionCli } from './session.js'
import { runConversationsCli } from './conversations.js'
import { runEvalCli } from './eval.js'
import { listWorkerDispatchProviderIds, loadProviderRegistry } from './providers.js'
import { runConnectCli } from './connect.js'
import { runDaemonCli } from './daemon.js'
import { runDoctorCli } from './doctor.js'
import {
  buildCommanderSessionName,
  isOwnedByCommander,
  workerLifecycle,
} from './session-contract.js'
import { runUpCli } from './up.js'
import { runUpdateCli } from './update.js'

interface Writable {
  write(chunk: string): boolean
}

interface CommanderWorkerDispatchOptions {
  commanderId: string
  host: string
  agentType: string
  task?: string
  cwd?: string
  sessionName: string
  permissionMode?: PermissionMode
  skipValidation: boolean
}

interface CommandersCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HerdConfig | null>
  stdout?: Writable
  stderr?: Writable
}

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildApiUrl(endpoint: string, apiPath: string): string {
  return new URL(apiPath, `${normalizeEndpoint(endpoint)}/`).toString()
}

function buildAuthHeaders(config: HerdConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }
}

async function readErrorDetail(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.toLowerCase().includes('application/json')

  if (isJson) {
    try {
      const payload = (await response.json()) as unknown
      if (!isObject(payload)) {
        return null
      }

      const message = payload.message
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim()
      }

      const error = payload.error
      if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim()
      }
    } catch {
      return null
    }
    return null
  }

  try {
    const text = (await response.text()).trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

function printRootUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  herd onboard\n')
  stdout.write('  herd doctor\n')
  stdout.write('  herd machine <command>\n')
  stdout.write('  herd quests <command>\n')
  stdout.write('  herd workers <command>\n')
  stdout.write('  herd conversations <command>\n')
  stdout.write('  herd connect <url> --token <enrollment-token>\n')
  stdout.write('  herd daemon run --machine <id> --pairing-token <token> --endpoint <url>\n')
  stdout.write('  herd automation <command>\n')
  stdout.write('  herd commander <command>\n')
  stdout.write('  herd commander transcripts <command>\n')
  stdout.write(
    '  herd commanders workers dispatch --commander <id> --host <machine-id> --agent <provider> [--task <text>] [--cwd <path>] [--name <session-name>] [--permission-mode <default|acceptEdits|bypassPermissions>] [--skip-validation]\n',
  )
  stdout.write('  herd memory <command>\n')
  stdout.write('  herd eval <command>\n')
  stdout.write('  herd session <command>\n')
  stdout.write('  herd sessions <command>\n')
  stdout.write('  herd up [--dev] [--port <port>]\n')
  stdout.write('  herd run [--dev] [--port <port>]\n')
  stdout.write('  herd update [--tag <release-tag>]\n')
}

function printCommandersUsage(stdout: Writable): void {
  stdout.write(
    'Usage: herd commanders workers dispatch --commander <id> --host <machine-id> --agent <provider> [--task <text>] [--cwd <path>] [--name <session-name>] [--permission-mode <default|acceptEdits|bypassPermissions>] [--skip-validation]\n',
  )
}

function parsePermissionMode(value: string | undefined): PermissionMode | null {
  const normalized = value?.trim()
  if (
    normalized === 'default' ||
    normalized === 'acceptEdits' ||
    normalized === 'bypassPermissions'
  ) {
    return normalized
  }
  return null
}

function parseCommandersWorkerDispatchOptions(
  args: readonly string[],
): CommanderWorkerDispatchOptions | null {
  if (args.length < 2 || args[0] !== 'workers' || args[1] !== 'dispatch') {
    return null
  }

  let commanderId: string | undefined
  let host: string | undefined
  let agentType: string | undefined
  let task: string | undefined
  let cwd: string | undefined
  let sessionName: string | undefined
  let permissionMode: PermissionMode | undefined
  let skipValidation = false

  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--skip-validation') {
      skipValidation = true
      continue
    }
    const value = args[index + 1]?.trim()

    if (
      flag !== '--commander' &&
      flag !== '--host' &&
      flag !== '--agent' &&
      flag !== '--task' &&
      flag !== '--cwd' &&
      flag !== '--name' &&
      flag !== '--permission-mode'
    ) {
      return null
    }
    if (!value) {
      return null
    }

    if (flag === '--commander') {
      commanderId = value
    } else if (flag === '--host') {
      host = value
    } else if (flag === '--agent') {
      agentType = value
    } else if (flag === '--task') {
      task = value
    } else if (flag === '--cwd') {
      if (!value.startsWith('/')) {
        return null
      }
      cwd = value
    } else if (flag === '--name') {
      sessionName = value
    } else if (flag === '--permission-mode') {
      const parsedMode = parsePermissionMode(value)
      if (!parsedMode) {
        return null
      }
      permissionMode = parsedMode
    }

    index += 1
  }

  if (!commanderId || !host || !agentType) {
    return null
  }

  return {
    commanderId,
    host,
    agentType,
    task,
    cwd,
    sessionName: sessionName ?? `worker-${Date.now()}`,
    permissionMode,
    skipValidation,
  }
}

async function runCommandersWorkersDispatch(
  config: HerdConfig,
  options: CommanderWorkerDispatchOptions,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  let response: Response
  try {
    response = await fetchImpl(
      buildApiUrl(
        config.endpoint,
        `/api/commanders/${encodeURIComponent(options.commanderId)}/workers`,
      ),
      {
        method: 'POST',
        headers: buildAuthHeaders(config),
        body: JSON.stringify({
          name: options.sessionName,
          host: options.host,
          agentType: options.agentType,
          ...(options.task ? { task: options.task } : {}),
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
        }),
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    stderr.write(`Dispatch request failed: ${message}\n`)
    return 1
  }

  if (!response.ok) {
    if (response.status === 401) {
      stderr.write(`${formatStoredApiKeyUnauthorizedMessage({ endpoint: config.endpoint })}\n`)
      return 1
    }

    const detail = await readErrorDetail(response)
    stderr.write(
      detail
        ? `Request failed (${response.status}): ${detail}\n`
        : `Request failed (${response.status}).\n`,
    )
    return 1
  }

  const payloadResult = await readJsonResponse(response)
  if (!payloadResult.ok) {
    const detail = await readErrorDetail(payloadResult.response)
    stderr.write(
      detail
        ? `Request failed (${payloadResult.response.status}): ${detail}\n`
        : `Request failed (${payloadResult.response.status}).\n`,
    )
    return 1
  }

  const data = isObject(payloadResult.data) ? payloadResult.data : {}
  const sessionName = typeof data.sessionName === 'string' && data.sessionName.trim().length > 0
    ? data.sessionName.trim()
    : typeof data.name === 'string' && data.name.trim().length > 0
      ? data.name.trim()
      : null
  const routedHost = typeof data.host === 'string' && data.host.trim().length > 0
    ? data.host.trim()
    : options.host

  if (!sessionName) {
    stderr.write('Worker dispatch response was malformed: expected a JSON object with a string sessionName or name.\n')
    return 1
  }

  stdout.write(`Worker dispatched: ${sessionName}\n`)
  stdout.write(`Host: ${routedHost}\n`)

  return 0
}

export async function runCommandersCli(
  args: readonly string[],
  dependencies: CommandersCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const readConfig = dependencies.readConfig ?? readHerdConfig
  const options = parseCommandersWorkerDispatchOptions(args)
  if (!options) {
    printCommandersUsage(stdout)
    return 1
  }

  const config = await readConfig()
  if (!config) {
    stderr.write('Herd config not found. Run `herd onboard` first.\n')
    return 1
  }

  if (!options.skipValidation) {
    try {
      const { providers } = await loadProviderRegistry(config, { fetchImpl })
      const validAgentTypes = new Set(listWorkerDispatchProviderIds(providers))
      if (!validAgentTypes.has(options.agentType)) {
        stderr.write(
          `Invalid --agent "${options.agentType}". Expected one of: ${[...validAgentTypes].join(', ')}.\n`,
        )
        return 1
      }
    } catch {
      stderr.write('Cannot validate --agent without a running Herd server. Start the server first or pass --skip-validation.\n')
      return 1
    }
  }

  return runCommandersWorkersDispatch(config, options, fetchImpl, stdout, stderr)
}

export async function runCli(args: readonly string[]): Promise<number> {
  const command = args[0]

  if (!command || command === 'onboard') {
    return runOnboardCli(command ? args : [])
  }
  if (command === 'doctor') {
    return runDoctorCli(args.slice(1))
  }
  if (command === 'machine') {
    return runMachinesCli(args.slice(1))
  }
  if (command === 'quests') {
    return runQuestsCli(args.slice(1))
  }
  if (command === 'workers') {
    return runWorkersCli(args.slice(1))
  }
  if (command === 'conversations') {
    return runConversationsCli(args.slice(1))
  }
  if (command === 'connect') {
    return runConnectCli(args.slice(1))
  }
  if (command === 'daemon') {
    return runDaemonCli(args.slice(1))
  }
  if (command === 'automation') {
    return runAutomationCli(args.slice(1))
  }
  if (command === 'commander') {
    return runCommanderCli(args.slice(1))
  }
  if (command === 'commanders') {
    return runCommandersCli(args.slice(1))
  }
  if (command === 'memory') {
    return runMemoryCli(args.slice(1))
  }
  if (command === 'eval') {
    return runEvalCli(args.slice(1))
  }
  if (command === 'session' || command === 'sessions') {
    return runSessionCli(args.slice(1))
  }
  if (command === 'up' || command === 'run') {
    return runUpCli(args.slice(1))
  }
  if (command === 'update') {
    return runUpdateCli(args.slice(1))
  }

  printRootUsage(process.stdout)
  return 1
}

export { runUpCli } from './up.js'
export { runMachinesCli } from './machines.js'
export { runQuestsCli } from './quests.js'
export { runWorkersCli } from './workers.js'
export { runConversationsCli } from './conversations.js'
export { runDaemonCli } from './daemon.js'
export { runCommanderCli } from './commander.js'
export { runAutomationCli } from './automation.js'
export { runMemoryCli } from './memory.js'
export { runEvalCli } from './eval.js'
export { runSessionCli } from './session.js'
export { runTranscriptsCli } from './transcripts.js'
export { runUpdateCli } from './update.js'
export { buildCommanderSessionName, isOwnedByCommander, workerLifecycle }
