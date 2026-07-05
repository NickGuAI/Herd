import { hostname } from 'node:os'
import { normalizeEndpoint } from './config.js'
import { fetchJson } from './http-json.js'
import { runDaemonCli, type DaemonCliDependencies } from './daemon.js'

interface Writable {
  write(chunk: string): boolean
}

interface ConnectOptions {
  endpoint: string
  token: string
}

interface EnrollmentCredentials {
  machineId: string
  pairingToken: string
  endpoint: string
}

type RunDaemonCli = (
  args: readonly string[],
  deps?: DaemonCliDependencies,
) => Promise<number>

export interface ConnectCliDependencies extends DaemonCliDependencies {
  fetchImpl?: typeof fetch
  hostnameImpl?: () => string
  runDaemonImpl?: RunDaemonCli
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  herd connect <url> --token <enrollment-token>\n')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildApiUrl(endpoint: string, apiPath: string): string {
  return new URL(apiPath, `${normalizeEndpoint(endpoint)}/`).toString()
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

export function parseConnectOptions(args: readonly string[]): ConnectOptions | null {
  const endpoint = args[0]?.trim()
  if (!endpoint) {
    return null
  }

  let token: string | undefined
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]?.trim()
    if (!flag || !value) {
      return null
    }
    if (flag === '--token') {
      token = value
    } else {
      return null
    }
  }

  if (!token) {
    return null
  }

  return {
    endpoint: normalizeEndpoint(endpoint),
    token,
  }
}

function parseEnrollmentCredentials(payload: unknown, fallbackEndpoint: string): EnrollmentCredentials | null {
  if (!isObject(payload) || !isObject(payload.credentials)) {
    return null
  }
  const machineId = typeof payload.credentials.machineId === 'string'
    ? payload.credentials.machineId.trim()
    : ''
  const pairingToken = typeof payload.credentials.pairingToken === 'string'
    ? payload.credentials.pairingToken.trim()
    : ''
  const endpoint = typeof payload.credentials.endpoint === 'string' && payload.credentials.endpoint.trim().length > 0
    ? payload.credentials.endpoint.trim()
    : fallbackEndpoint
  if (!machineId || !pairingToken) {
    return null
  }
  return {
    machineId,
    pairingToken,
    endpoint: normalizeEndpoint(endpoint),
  }
}

export async function runConnectCli(
  args: readonly string[],
  deps: ConnectCliDependencies = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const fetchImpl = deps.fetchImpl ?? fetch
  const runDaemonImpl = deps.runDaemonImpl ?? runDaemonCli
  const hostnameImpl = deps.hostnameImpl ?? hostname
  const options = parseConnectOptions(args)

  if (!options) {
    printUsage(stdout)
    return 1
  }

  let enrollUrl: string
  try {
    enrollUrl = buildApiUrl(options.endpoint, '/api/agents/machines/enroll')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid endpoint'
    stderr.write(`Invalid Herd endpoint: ${message}\n`)
    return 1
  }

  const result = await fetchJson(fetchImpl, enrollUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      token: options.token,
      label: hostnameImpl(),
      cwd: process.cwd(),
    }),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(detail ? `Enrollment failed (${result.response.status}): ${detail}\n` : `Enrollment failed (${result.response.status}).\n`)
    return 1
  }

  const credentials = parseEnrollmentCredentials(result.data, options.endpoint)
  if (!credentials) {
    stderr.write('Enrollment response was empty.\n')
    return 1
  }

  stdout.write(`Enrolled machine: ${credentials.machineId}\n`)
  stdout.write('Starting daemon...\n')
  return runDaemonImpl([
    'run',
    '--machine',
    credentials.machineId,
    '--pairing-token',
    credentials.pairingToken,
    '--endpoint',
    credentials.endpoint,
  ], deps)
}
