import { spawn, type ChildProcess } from 'node:child_process'
import { platform, arch } from 'node:os'
import { normalizeEndpoint } from './config.js'

interface Writable {
  write(chunk: string): boolean
}

interface DaemonRunOptions {
  machineId: string
  pairingToken: string
  endpoint: string
}

interface DaemonProviderHealth {
  provider: string
  installed: boolean
  authenticated: boolean
  version: string | null
  authMethod: string | null
  detail: string | null
  checkedAt: string | null
}

interface DaemonServerSpawnMessage {
  type: 'spawn'
  requestId: string
  processId: string
  mode: 'pipe' | 'pty'
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

type DaemonServerMessage =
  | DaemonServerSpawnMessage
  | { type: 'stdin'; processId: string; data: string }
  | { type: 'resize'; processId: string; cols: number; rows: number }
  | { type: 'kill'; processId: string; signal?: string }

interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: Event | MessageEvent) => void,
    options?: { once?: boolean },
  ): void
}

type DaemonWebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocketLike

export interface DaemonCliDependencies {
  stdout?: Writable
  stderr?: Writable
  WebSocketImpl?: DaemonWebSocketConstructor
  spawnImpl?: typeof spawn
  env?: NodeJS.ProcessEnv
  reconnectDelayMs?: number
  maxBufferedMessages?: number
  signal?: AbortSignal
}

const DAEMON_VERSION = '0.1.0'
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000

const PROVIDERS = [
  {
    provider: 'claude',
    binary: 'claude',
    authEnvKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    loginStatusArgs: ['auth', 'status'],
  },
  {
    provider: 'codex',
    binary: 'codex',
    authEnvKeys: ['OPENAI_API_KEY'],
    loginStatusArgs: ['login', 'status'],
  },
  {
    provider: 'gemini',
    binary: 'gemini',
    authEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    loginStatusArgs: null,
  },
  {
    provider: 'opencode',
    binary: 'opencode',
    authEnvKeys: ['OPENCODE_API_KEY'],
    loginStatusArgs: null,
  },
] as const

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi daemon run --machine <id> --pairing-token <token> --endpoint <url>\n')
  stdout.write('\n')
  stdout.write('Note: CLI daemon PTY mode is stdio-backed. Resize messages are accepted but are no-ops unless a future CLI PTY dependency is added.\n')
}

export function parseDaemonRunOptions(args: readonly string[]): DaemonRunOptions | null {
  if (args[0] !== 'run') {
    return null
  }

  let machineId: string | undefined
  let pairingToken: string | undefined
  let endpoint: string | undefined

  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]?.trim()
    if (!flag || !value) {
      return null
    }
    if (flag === '--machine') {
      machineId = value
    } else if (flag === '--pairing-token') {
      pairingToken = value
    } else if (flag === '--endpoint') {
      endpoint = value
    } else {
      return null
    }
  }

  if (!machineId || !pairingToken || !endpoint) {
    return null
  }

  return {
    machineId,
    pairingToken,
    endpoint: normalizeEndpoint(endpoint),
  }
}

function buildDaemonWebSocketUrl(options: DaemonRunOptions): string {
  const endpoint = normalizeEndpoint(options.endpoint)
  const base = endpoint.startsWith('https://')
    ? `wss://${endpoint.slice('https://'.length)}`
    : endpoint.startsWith('http://')
      ? `ws://${endpoint.slice('http://'.length)}`
      : endpoint
  const url = new URL('/api/agents/daemons/ws', `${base}/`)
  url.searchParams.set('machine_id', options.machineId)
  return url.toString()
}

function sendJson(ws: WebSocketLike, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload))
}

async function runVersionProbe(
  binary: string,
  spawnImpl: typeof spawn,
  env: NodeJS.ProcessEnv,
): Promise<{ installed: boolean; version: string | null; detail: string | null }> {
  return await new Promise((resolve) => {
    const child = spawnImpl(binary, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ installed: true, version: stdout.trim() || null, detail: 'version probe timed out' })
    }, 2_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      const code = (error as NodeJS.ErrnoException).code
      resolve({
        installed: false,
        version: null,
        detail: code === 'ENOENT' ? 'missing' : error.message,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        installed: code === 0 || stdout.trim().length > 0,
        version: stdout.trim().split(/\r?\n/u)[0] || null,
        detail: code === 0 ? null : (stderr.trim().split(/\r?\n/u)[0] || null),
      })
    })
  })
}

async function runAuthProbe(
  binary: string,
  args: readonly string[],
  spawnImpl: typeof spawn,
  env: NodeJS.ProcessEnv,
): Promise<{ authenticated: boolean; detail: string | null }> {
  return await new Promise((resolve) => {
    let settled = false
    const child = spawnImpl(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })
    let stdout = ''
    let stderr = ''

    const finish = (authenticated: boolean, detail: string | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({ authenticated, detail })
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(false, 'auth probe timed out')
    }, 2_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      finish(false, code === 'ENOENT' ? 'missing' : error.message)
    })
    child.on('close', (code) => {
      const detail = stderr.trim().split(/\r?\n/u)[0] ||
        stdout.trim().split(/\r?\n/u)[0] ||
        (code === 0 ? null : `auth probe exited ${code ?? -1}`)
      finish(code === 0, detail)
    })
  })
}

async function collectProviderHealth(
  spawnImpl: typeof spawn,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, DaemonProviderHealth>> {
  const checkedAt = new Date().toISOString()
  const entries: Array<[string, DaemonProviderHealth]> = []
  for (const provider of PROVIDERS) {
    const probe = await runVersionProbe(provider.binary, spawnImpl, env)
    const envKey = provider.authEnvKeys.find((key) => Boolean(env[key]?.trim()))
    const authProbe = !envKey && probe.installed && provider.loginStatusArgs
      ? await runAuthProbe(provider.binary, provider.loginStatusArgs, spawnImpl, env)
      : null
    const authenticated = Boolean(envKey) || Boolean(authProbe?.authenticated)
    entries.push([provider.provider, {
      provider: provider.provider,
      installed: probe.installed,
      authenticated,
      version: probe.version,
      authMethod: envKey ? 'env' : (authProbe?.authenticated ? 'login' : null),
      detail: probe.detail ?? authProbe?.detail ?? null,
      checkedAt,
    }])
  }
  return Object.fromEntries(entries)
}

function normalizeSpawnEnv(
  endpoint: string,
  baseEnv: NodeJS.ProcessEnv,
  incoming: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv, ...(incoming ?? {}) }
  const approvalBase = env.HAMMURABI_APPROVAL_BASE_URL?.trim()
  if (!approvalBase || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/u.test(approvalBase)) {
    env.HAMMURABI_APPROVAL_BASE_URL = normalizeEndpoint(endpoint)
  }
  return env
}

function parseServerMessage(raw: unknown): DaemonServerMessage | null {
  let payload: unknown = raw
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>
  if (record.type === 'spawn') {
    const args = Array.isArray(record.args) && record.args.every((arg) => typeof arg === 'string')
      ? record.args
      : null
    if (
      typeof record.requestId !== 'string' ||
      typeof record.processId !== 'string' ||
      (record.mode !== 'pipe' && record.mode !== 'pty') ||
      typeof record.command !== 'string' ||
      !args
    ) {
      return null
    }
    return {
      type: 'spawn',
      requestId: record.requestId,
      processId: record.processId,
      mode: record.mode,
      command: record.command,
      args,
      ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
      ...(record.env && typeof record.env === 'object' ? { env: record.env as Record<string, string> } : {}),
      ...(typeof record.cols === 'number' ? { cols: record.cols } : {}),
      ...(typeof record.rows === 'number' ? { rows: record.rows } : {}),
    }
  }
  if (record.type === 'stdin' && typeof record.processId === 'string' && typeof record.data === 'string') {
    return { type: 'stdin', processId: record.processId, data: record.data }
  }
  if (
    record.type === 'resize' &&
    typeof record.processId === 'string' &&
    typeof record.cols === 'number' &&
    typeof record.rows === 'number'
  ) {
    return { type: 'resize', processId: record.processId, cols: record.cols, rows: record.rows }
  }
  if (record.type === 'kill' && typeof record.processId === 'string') {
    return {
      type: 'kill',
      processId: record.processId,
      ...(typeof record.signal === 'string' ? { signal: record.signal } : {}),
    }
  }
  return null
}

function messageDataToString(event: MessageEvent): string {
  const data = event.data
  if (typeof data === 'string') {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }
  return String(data)
}

export async function runDaemonCli(
  args: readonly string[],
  dependencies: DaemonCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const options = parseDaemonRunOptions(args)
  if (!options) {
    printUsage(stdout)
    return 1
  }
  const runOptions = options

  const WebSocketImpl = dependencies.WebSocketImpl ?? globalThis.WebSocket
  if (!WebSocketImpl) {
    stderr.write('This Node.js runtime does not provide a WebSocket client. Use Node 22 or newer.\n')
    return 1
  }

  const spawnImpl = dependencies.spawnImpl ?? spawn
  const env = dependencies.env ?? process.env
  const websocketUrl = buildDaemonWebSocketUrl(runOptions)
  const children = new Map<string, ChildProcess>()
  const bufferedClientMessages: Array<Record<string, unknown>> = []
  const maxBufferedMessages = dependencies.maxBufferedMessages ?? 10_000
  const configuredReconnectDelayMs = Number.parseInt(env.HAMMURABI_DAEMON_RECONNECT_MS ?? '', 10)
  const reconnectDelayMs = dependencies.reconnectDelayMs
    ?? (Number.isFinite(configuredReconnectDelayMs) && configuredReconnectDelayMs > 0
      ? configuredReconnectDelayMs
      : 1_000)
  let activeWs: WebSocketLike | null = null
  let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS
  let heartbeatSequence = 0
  let heartbeatTimer: NodeJS.Timeout | null = null
  let reconnectTimer: NodeJS.Timeout | null = null

  const isOpen = (ws: WebSocketLike | null): ws is WebSocketLike => ws?.readyState === 1

  function sendDirect(ws: WebSocketLike | null, payload: Record<string, unknown>): boolean {
    if (!isOpen(ws)) {
      return false
    }
    try {
      sendJson(ws, payload)
      return true
    } catch {
      return false
    }
  }

  function queueClientMessage(payload: Record<string, unknown>): void {
    if (bufferedClientMessages.length >= maxBufferedMessages) {
      bufferedClientMessages.shift()
    }
    bufferedClientMessages.push(payload)
  }

  function sendToServer(payload: Record<string, unknown>): void {
    if (!sendDirect(activeWs, payload)) {
      queueClientMessage(payload)
    }
  }

  function flushBufferedClientMessages(): void {
    while (bufferedClientMessages.length > 0) {
      const payload = bufferedClientMessages.shift()!
      if (!sendDirect(activeWs, payload)) {
        bufferedClientMessages.unshift(payload)
        return
      }
    }
  }

  const sendProviderState = async (type: 'hello' | 'heartbeat', ws: WebSocketLike | null = activeWs) => {
    const providerHealth = await collectProviderHealth(spawnImpl, env)
    if (ws !== activeWs) {
      return
    }
    sendDirect(ws, {
      type,
      ...(type === 'hello'
        ? {
            protocolVersion: 1,
            machineId: runOptions.machineId,
            daemonVersion: DAEMON_VERSION,
            pid: process.pid,
            platform: platform(),
            arch: arch(),
          }
        : {
            sequence: heartbeatSequence++,
            activeProcesses: children.size,
          }),
      providerHealth,
    })
  }

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const startHeartbeat = (ws: WebSocketLike) => {
    clearHeartbeat()
    heartbeatTimer = setInterval(() => {
      void sendProviderState('heartbeat', ws).catch((error) => {
        stderr.write(`daemon heartbeat failed: ${error instanceof Error ? error.message : String(error)}\n`)
      })
    }, heartbeatIntervalMs)
  }

  function handleSpawn(message: DaemonServerSpawnMessage): void {
    const child = spawnImpl(message.command, message.args, {
      cwd: message.cwd,
      env: normalizeSpawnEnv(runOptions.endpoint, env, message.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    children.set(message.processId, child)

    sendToServer({
      type: 'spawned',
      requestId: message.requestId,
      processId: message.processId,
      pid: child.pid ?? null,
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      sendToServer({
        type: message.mode === 'pty' ? 'pty-data' : 'stdout',
        processId: message.processId,
        data: chunk.toString(),
      })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      sendToServer({
        type: message.mode === 'pty' ? 'pty-data' : 'stderr',
        processId: message.processId,
        data: chunk.toString(),
      })
    })
    child.on('error', (error) => {
      children.delete(message.processId)
      sendToServer({
        type: 'error',
        requestId: message.requestId,
        processId: message.processId,
        message: error.message,
      })
    })
    child.on('exit', (code, signal) => {
      children.delete(message.processId)
      sendToServer({
        type: 'exit',
        processId: message.processId,
        exitCode: code,
        signal,
      })
    })
  }

  function handleServerMessage(message: DaemonServerMessage): void {
    if (message.type === 'spawn') {
      try {
        handleSpawn(message)
      } catch (error) {
        sendToServer({
          type: 'error',
          requestId: message.requestId,
          processId: message.processId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    const child = children.get(message.processId)
    if (!child) {
      return
    }
    if (message.type === 'stdin') {
      child.stdin?.write(message.data)
      return
    }
    if (message.type === 'kill') {
      child.kill((message.signal ?? 'SIGTERM') as NodeJS.Signals)
      return
    }
    if (message.type === 'resize') {
      // Stdio-backed PTY compatibility mode: resize is a protocol no-op.
    }
  }

  return await new Promise<number>((resolve) => {
    let settled = false
    const finish = (code: number) => {
      if (settled) {
        return
      }
      settled = true
      clearHeartbeat()
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      for (const child of children.values()) {
        child.kill('SIGTERM')
      }
      try {
        activeWs?.close(1000, 'daemon shutting down')
      } catch {
        // Best effort.
      }
      resolve(code)
    }

    const scheduleReconnect = () => {
      if (settled || reconnectTimer) {
        return
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, reconnectDelayMs)
    }

    function connect(): void {
      const ws = new WebSocketImpl(websocketUrl, ['hammurabi-daemon', runOptions.pairingToken])
      activeWs = ws
      let disconnected = false

      const markDisconnected = () => {
        if (disconnected) {
          return
        }
        disconnected = true
        if (activeWs === ws) {
          activeWs = null
        }
        clearHeartbeat()
        scheduleReconnect()
      }

      ws.addEventListener('open', () => {
        stdout.write(`Connected daemon for machine ${runOptions.machineId}.\n`)
        void sendProviderState('hello', ws)
          .then(() => flushBufferedClientMessages())
          .catch((error) => {
            stderr.write(`daemon hello failed: ${error instanceof Error ? error.message : String(error)}\n`)
          })
        startHeartbeat(ws)
      }, { once: true })

      ws.addEventListener('message', (event) => {
        const raw = messageDataToString(event as MessageEvent)
        let parsedRaw: unknown
        try {
          parsedRaw = JSON.parse(raw) as unknown
        } catch {
          return
        }
        if (
          parsedRaw &&
          typeof parsedRaw === 'object' &&
          (parsedRaw as { type?: unknown }).type === 'welcome'
        ) {
          const nextInterval = (parsedRaw as { heartbeatIntervalMs?: unknown }).heartbeatIntervalMs
          if (typeof nextInterval === 'number' && Number.isFinite(nextInterval) && nextInterval > 0) {
            heartbeatIntervalMs = nextInterval
            startHeartbeat(ws)
          }
          return
        }
        const message = parseServerMessage(parsedRaw)
        if (message) {
          handleServerMessage(message)
        }
      })

      ws.addEventListener('error', () => {
        stderr.write('Daemon websocket error.\n')
        try {
          ws.close()
        } catch {
          // Best effort; close will normally follow an error.
        }
        markDisconnected()
      }, { once: true })

      ws.addEventListener('close', () => {
        markDisconnected()
      }, { once: true })
    }

    dependencies.signal?.addEventListener('abort', () => {
      finish(0)
    }, { once: true })

    if (dependencies.signal?.aborted) {
      finish(0)
      return
    }

    connect()
  })
}
