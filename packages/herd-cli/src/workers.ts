import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HerdConfig, normalizeEndpoint, readHerdConfig } from './config.js'
import { fetchJson as fetchJsonStrict } from './http-json.js'
import { listWorkerDispatchProviderIds, loadProviderRegistry } from './providers.js'
import {
  formatRuntimeAllowedActions,
  formatRuntimeDisabledReasons,
  isOwnedByCommander,
  normalizeRuntimeSessionState,
  normalizeSessionCreator,
  normalizeSessionType,
  parseRuntimeSessionAllowedActions,
  parseRuntimeSessionDisabledReasons,
  workerLifecycle,
  workerLifecycleWithRuntimeState,
  type AgentRuntimeSessionState,
  type RuntimeSessionAllowedActions,
  type RuntimeSessionDisabledReasons,
  type SessionCreator,
} from './session-contract.js'
import {
  buildSessionMessagesApiPath,
  DEFAULT_JSON_PEEK_LAST,
  parseSessionMessagePeekResponse,
  parseSessionPeekCommandArgs,
  renderSessionPeekEntries,
  type SessionMessagePeekResponse,
} from './session-peek.js'

interface Writable {
  write(chunk: string): boolean
}

interface DispatchOptions {
  spawnedBy?: string
  task?: string
  machine?: string
  agentType?: string
  cwd?: string
  permissionMode?: PermissionMode
  skipValidation?: boolean
}

interface ListOptions {
  all: boolean
  allCreators: boolean
}

interface CleanupOptions {
  dryRun: boolean
}

interface SendOptions {
  sessionName: string
  text: string
}

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'

const DISPATCH_TIMEOUT_MS = 300_000

interface AgentSessionSummary {
  name: string
  sessionType?: string
  transportType?: string
  creator?: SessionCreator
  status?: string
  state?: AgentRuntimeSessionState
  allowedActions?: RuntimeSessionAllowedActions
  disabledReasons?: RuntimeSessionDisabledReasons
  cwd?: string
  host?: string
  created?: string
  lastActivityAt?: string
  processAlive?: boolean
}

interface WorkerSessionStatus {
  name: string
  completed: boolean
  status?: string
  state?: AgentRuntimeSessionState
  allowedActions?: RuntimeSessionAllowedActions
  disabledReasons?: RuntimeSessionDisabledReasons
  sessionType?: string
  transportType?: string
  host?: string
  processAlive?: boolean
}

interface SweepCandidate {
  name: string
  sessionType?: string
  creator?: SessionCreator
  lifecycle?: string
  ageMs?: number
  reason?: string
}

export interface WorkersCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HerdConfig | null>
  stdout?: Writable
  stderr?: Writable
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  herd workers list [--all] [--all-creators]\n')
  stdout.write(
    '  herd workers dispatch [--session <name>] [--task <text>] [--cwd <path>] [--machine <id>] [--agent <provider>] [--permission-mode <default|acceptEdits|bypassPermissions>] [--skip-validation]\n',
  )
  stdout.write('  herd workers cleanup [--dry-run]\n')
  stdout.write('  herd workers kill <name>\n')
  stdout.write('  herd workers status <session-name> [--tail <N>] [--json]\n')
  stdout.write('  herd workers send <session-name> "<text>"\n')
}

function buildApiUrl(endpoint: string, apiPath: string): string {
  return new URL(apiPath, `${normalizeEndpoint(endpoint)}/`).toString()
}

function buildAuthHeaders(config: HerdConfig, includeJsonContentType: boolean): HeadersInit {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
  }

  if (includeJsonContentType) {
    headers['content-type'] = 'application/json'
  }

  return headers
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  return fetchJsonStrict(fetchImpl, url, init)
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

async function writeRequestFailure(
  stderr: Writable,
  response: Response,
  config: HerdConfig,
): Promise<void> {
  if (response.status === 401) {
    stderr.write(`${formatStoredApiKeyUnauthorizedMessage({ endpoint: config.endpoint })}\n`)
    return
  }

  const detail = await readErrorDetail(response)
  stderr.write(
    detail
      ? `Request failed (${response.status}): ${detail}\n`
      : `Request failed (${response.status}).\n`,
  )
}

function parseSessionName(value: string | undefined): string | null {
  const name = value?.trim() ?? ''
  return name.length > 0 ? name : null
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function parseDispatchOptions(args: readonly string[]): DispatchOptions | null {
  let spawnedBy: string | undefined
  let task: string | undefined
  let machine: string | undefined
  let agentType: string | undefined
  let cwd: string | undefined
  let permissionMode: PermissionMode | undefined
  let skipValidation = false

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--skip-validation') {
      skipValidation = true
      continue
    }
    const value = args[index + 1]?.trim()

    if (
      flag !== '--session' &&
      flag !== '--task' &&
      flag !== '--machine' &&
      flag !== '--agent' &&
      flag !== '--cwd' &&
      flag !== '--permission-mode'
    ) {
      return null
    }
    if (!value) {
      return null
    }

    if (flag === '--session') {
      spawnedBy = value
    } else if (flag === '--task') {
      task = value
    } else if (flag === '--machine') {
      machine = value
    } else if (flag === '--agent') {
      agentType = value
    } else if (flag === '--cwd') {
      if (!value.startsWith('/')) {
        return null
      }
      cwd = value
    } else if (flag === '--permission-mode') {
      const parsedMode = parsePermissionMode(value)
      if (!parsedMode) {
        return null
      }
      permissionMode = parsedMode
    }

    index += 1
  }

  if (!spawnedBy) {
    const envSessionName = process.env.HERD_SESSION_NAME?.trim()
    if (envSessionName) {
      spawnedBy = envSessionName
    }
  }

  return {
    spawnedBy,
    task,
    machine,
    agentType,
    cwd,
    permissionMode,
    skipValidation,
  }
}

function parseListOptions(args: readonly string[]): ListOptions | null {
  const options: ListOptions = {
    all: false,
    allCreators: false,
  }

  for (const arg of args) {
    if (arg === '--all') {
      options.all = true
      continue
    }
    if (arg === '--all-creators') {
      options.all = true
      options.allCreators = true
      continue
    }
    return null
  }

  return options
}

function parseCleanupOptions(args: readonly string[]): CleanupOptions | null {
  if (args.length === 0) {
    return { dryRun: false }
  }
  if (args.length === 1 && args[0] === '--dry-run') {
    return { dryRun: true }
  }
  return null
}

async function runKill(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  sessionName: string,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/agents/sessions/${encodeURIComponent(sessionName)}`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  stdout.write(`Session ${sessionName} killed.\n`)
  return 0
}

function parseSendOptions(args: readonly string[]): SendOptions | null {
  const sessionName = parseSessionName(args[0])
  const text = args[1]?.trim() ?? ''

  if (!sessionName || text.length === 0 || args.length !== 2) {
    return null
  }

  return {
    sessionName,
    text,
  }
}

function parseSessions(payload: unknown): AgentSessionSummary[] {
  const raw = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.sessions) ? payload.sessions : [])

  const sessions: AgentSessionSummary[] = []
  for (const entry of raw) {
    if (!isObject(entry)) {
      continue
    }

    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) {
      continue
    }

    const sessionType = normalizeSessionType(entry.sessionType) ?? undefined
    const transportType = typeof entry.transportType === 'string' ? entry.transportType.trim() : undefined
    const creator = normalizeSessionCreator(entry.creator) ?? undefined
    const status = typeof entry.status === 'string' ? entry.status.trim() : undefined
    const state = normalizeRuntimeSessionState(entry.state) ?? undefined
    const cwd = typeof entry.cwd === 'string' ? entry.cwd.trim() : undefined
    const host = typeof entry.host === 'string' ? entry.host.trim() : undefined
    const created = typeof entry.created === 'string' ? entry.created.trim() : undefined
    const lastActivityAt = typeof entry.lastActivityAt === 'string' ? entry.lastActivityAt.trim() : undefined
    const processAlive = typeof entry.processAlive === 'boolean' ? entry.processAlive : undefined

    sessions.push({
      name,
      sessionType,
      transportType: transportType && transportType.length > 0 ? transportType : undefined,
      creator,
      status: status && status.length > 0 ? status : undefined,
      state,
      allowedActions: parseRuntimeSessionAllowedActions(entry.allowedActions),
      disabledReasons: parseRuntimeSessionDisabledReasons(entry.disabledReasons),
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      host: host && host.length > 0 ? host : undefined,
      created: created && created.length > 0 ? created : undefined,
      lastActivityAt: lastActivityAt && lastActivityAt.length > 0 ? lastActivityAt : undefined,
      processAlive,
    })
  }

  return sessions
}

function parseWorkerStatus(payload: unknown): WorkerSessionStatus | null {
  if (!isObject(payload)) {
    return null
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const status = typeof payload.status === 'string' ? payload.status.trim() : ''
  const completed =
    typeof payload.completed === 'boolean' ? payload.completed : status.toLowerCase() === 'completed'
  const sessionType = normalizeSessionType(payload.sessionType) ?? ''
  const transportType = typeof payload.transportType === 'string' ? payload.transportType.trim() : ''
  const host = typeof payload.host === 'string' ? payload.host.trim() : ''
  const processAlive = typeof payload.processAlive === 'boolean' ? payload.processAlive : undefined
  const state = normalizeRuntimeSessionState(payload.state) ?? undefined

  if (!name) {
    return null
  }

  return {
    name,
    completed,
    status: status.length > 0 ? status : undefined,
    state,
    allowedActions: parseRuntimeSessionAllowedActions(payload.allowedActions),
    disabledReasons: parseRuntimeSessionDisabledReasons(payload.disabledReasons),
    sessionType: sessionType.length > 0 ? sessionType : undefined,
    transportType: transportType.length > 0 ? transportType : undefined,
    host: host.length > 0 ? host : undefined,
    processAlive,
  }
}

async function fetchSessionPeek(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  sessionName: string,
  last: number,
): Promise<{ ok: true; data: SessionMessagePeekResponse } | { ok: false; error: string }> {
  const url = buildApiUrl(config.endpoint, buildSessionMessagesApiPath(sessionName, last))

  try {
    const result = await fetchJson(fetchImpl, url, {
      method: 'GET',
      headers: buildAuthHeaders(config, false),
    })

    if (!result.ok) {
      const detail = await readErrorDetail(result.response)
      return {
        ok: false,
        error: detail
          ? `Request failed (${result.response.status}): ${detail}`
          : `Request failed (${result.response.status}).`,
      }
    }

    const payload = parseSessionMessagePeekResponse(result.data)
    if (!payload) {
      return { ok: false, error: 'response was malformed' }
    }

    return { ok: true, data: payload }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

function parseSweepCandidates(payload: unknown): SweepCandidate[] {
  const raw = isObject(payload) && Array.isArray(payload.candidates) ? payload.candidates : []
  const candidates: SweepCandidate[] = []

  for (const entry of raw) {
    if (!isObject(entry)) {
      continue
    }

    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) {
      continue
    }

    candidates.push({
      name,
      sessionType: normalizeSessionType(entry.sessionType) ?? undefined,
      creator: normalizeSessionCreator(entry.creator) ?? undefined,
      lifecycle: typeof entry.lifecycle === 'string' ? entry.lifecycle.trim() : undefined,
      ageMs: typeof entry.ageMs === 'number' ? entry.ageMs : undefined,
      reason: typeof entry.reason === 'string' ? entry.reason.trim() : undefined,
    })
  }

  return candidates
}

function formatCreatorLabel(creator: SessionCreator | undefined): string {
  if (!creator) {
    return 'unknown'
  }
  return creator.id ? `${creator.kind}/${creator.id}` : creator.kind
}

function formatAgeMs(ageMs: number | undefined): string {
  if (!Number.isFinite(ageMs) || ageMs === undefined || ageMs < 0) {
    return '?'
  }
  if (ageMs < 60_000) {
    return `${Math.floor(ageMs / 1000)}s`
  }
  if (ageMs < 3_600_000) {
    return `${Math.floor(ageMs / 60_000)}m`
  }
  if (ageMs < 86_400_000) {
    return `${Math.floor(ageMs / 3_600_000)}h`
  }
  return `${Math.floor(ageMs / 86_400_000)}d`
}

function resolveAgeMs(session: AgentSessionSummary): number | undefined {
  const timestamp = session.lastActivityAt ?? session.created
  if (!timestamp) {
    return undefined
  }
  const timestampMs = Date.parse(timestamp)
  return Number.isFinite(timestampMs) ? Date.now() - timestampMs : undefined
}

function isCommanderCreatedSession(session: AgentSessionSummary): boolean {
  return session.creator?.kind === 'commander'
}

function isVisibleWorkerSession(session: AgentSessionSummary): boolean {
  if (session.state) {
    return session.state !== 'archived'
  }
  return workerLifecycle(session) === 'stale'
}

async function runList(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: ListOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(config.endpoint, '/api/agents/sessions')
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const commanderId = process.env.HERD_COMMANDER_ID?.trim() || null
  const sessions = parseSessions(result.data)
    .filter((session) => options.allCreators || isCommanderCreatedSession(session))
    .filter((session) => (
      options.allCreators
        ? true
        : (!commanderId || isOwnedByCommander(session, commanderId))
    ))
    .filter((session) => (options.all ? true : isVisibleWorkerSession(session)))

  if (sessions.length === 0) {
    stdout.write('No workers.\n')
    return 0
  }

  stdout.write('Workers:\n')
  for (const session of sessions) {
    const lifecycle = workerLifecycleWithRuntimeState(session)
    const runtimeState = session.state ? ` state=${session.state}` : ` lifecycle=${lifecycle}`
    const host = session.host ? ` host=${session.host}` : ''
    const cwd = session.cwd ? ` cwd=${session.cwd}` : ''
    stdout.write(
      `- ${session.name} type=${session.sessionType ?? 'unknown'} creator=${formatCreatorLabel(session.creator)}${runtimeState} age=${formatAgeMs(resolveAgeMs(session))}${host}${cwd}\n`,
    )
  }

  return 0
}

async function runDispatch(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: DispatchOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(config.endpoint, '/api/agents/sessions/dispatch-worker')
  const body: Record<string, unknown> = {}
  if (options.spawnedBy) {
    body.spawnedBy = options.spawnedBy
  }
  if (options.task) {
    body.task = options.task
  }
  if (options.machine) {
    body.host = options.machine
  }
  if (options.agentType) {
    body.agentType = options.agentType
  }
  if (options.cwd) {
    body.cwd = options.cwd
  }
  if (options.permissionMode) {
    body.permissionMode = options.permissionMode
  }

  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), DISPATCH_TIMEOUT_MS)
  let result: Awaited<ReturnType<typeof fetchJson>>

  try {
    result = await fetchJson(fetchImpl, url, {
      method: 'POST',
      headers: buildAuthHeaders(config, true),
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      stderr.write(`Dispatch request timed out after ${DISPATCH_TIMEOUT_MS / 1000}s.\n`)
      return 1
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    stderr.write(`Dispatch request failed: ${message}\n`)
    return 1
  } finally {
    clearTimeout(timeout)
  }

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const payload = isObject(result.data) ? result.data : null
  if (!payload) {
    stderr.write('Worker dispatch response was malformed: expected a JSON object with a string name.\n')
    return 1
  }

  const name = typeof payload.name === 'string' && payload.name.trim().length > 0
    ? payload.name
    : null
  if (!name) {
    stderr.write('Worker dispatch response was malformed: expected a JSON object with a string name.\n')
    return 1
  }
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined

  stdout.write(`Worker dispatched: ${name}\n`)
  if (cwd) {
    stdout.write(`Cwd: ${cwd}\n`)
  }
  return 0
}

async function runStatus(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  sessionName: string,
  options: { tail: number; json: boolean },
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/agents/sessions/${encodeURIComponent(sessionName)}`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const summary = parseWorkerStatus(result.data)
  if (!summary) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  const normalizedStatus = (summary.status ?? '').trim().toLowerCase()
  const lifecycleStatus = workerLifecycleWithRuntimeState({
    state: summary.state,
    status: summary.status,
    completed: summary.completed || normalizedStatus === 'completed',
    processAlive: summary.processAlive,
  })

  if (options.json) {
    const peek = await fetchSessionPeek(
      config,
      fetchImpl,
      sessionName,
      options.tail > 0 ? options.tail : DEFAULT_JSON_PEEK_LAST,
    )
    if (!peek.ok) {
      stderr.write(`Could not fetch messages: ${peek.error}\n`)
      return 1
    }

    stdout.write(`${JSON.stringify({
      session: summary.name,
      state: summary.state ?? null,
      status: summary.state ? (summary.status ?? null) : lifecycleStatus,
      lifecycle: lifecycleStatus,
      allowedActions: summary.allowedActions ?? null,
      disabledReasons: summary.disabledReasons ?? null,
      transport: summary.transportType ?? null,
      sessionType: summary.sessionType ?? null,
      host: summary.host ?? null,
      events: {
        total: peek.data.total,
        returned: peek.data.returned,
      },
      messages: peek.data.messages,
    }, null, 2)}\n`)
    return 0
  }

  stdout.write(`session: ${summary.name}\n`)
  if (summary.state) {
    stdout.write(`state: ${summary.state}\n`)
    if (summary.status && summary.status !== summary.state) {
      stdout.write(`status: ${summary.status}\n`)
    }
    const allowedActions = formatRuntimeAllowedActions(summary.allowedActions)
    if (allowedActions) {
      stdout.write(`allowed actions: ${allowedActions}\n`)
    }
    const disabledReasons = formatRuntimeDisabledReasons(summary.disabledReasons)
    if (disabledReasons) {
      stdout.write(`disabled actions: ${disabledReasons}\n`)
    }
  } else {
    stdout.write(`status: ${lifecycleStatus}\n`)
  }

  if (summary.completed && summary.status && summary.status !== lifecycleStatus) {
    stdout.write(`result: ${summary.status}\n`)
  }

  if (options.tail > 0) {
    const peek = await fetchSessionPeek(config, fetchImpl, sessionName, options.tail)
    if (!peek.ok) {
      stdout.write(`warning: could not fetch messages: ${peek.error}\n`)
      return 0
    }

    stdout.write(`last ${options.tail}:\n`)
    stdout.write(renderSessionPeekEntries(peek.data.messages))
  }

  return 0
}

async function runCleanup(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: CleanupOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const params = new URLSearchParams()
  if (options.dryRun) {
    params.set('dryRun', 'true')
  }
  const url = buildApiUrl(
    config.endpoint,
    `/api/agents/sessions/sweep${params.toString() ? `?${params.toString()}` : ''}`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const payload = isObject(result.data) ? result.data : {}
  const pruned = isObject(payload.pruned) ? payload.pruned : {}
  const automation = typeof pruned.automation === 'number'
    ? pruned.automation
    : (typeof pruned.cron === 'number' ? pruned.cron : 0)
  const nonHuman = typeof pruned.nonHuman === 'number' ? pruned.nonHuman : 0

  if (options.dryRun) {
    const candidates = parseSweepCandidates(payload)
    stdout.write(`Sweep dry run: automation=${automation} nonHuman=${nonHuman}\n`)
    if (candidates.length === 0) {
      stdout.write('No prune candidates.\n')
      return 0
    }
    for (const candidate of candidates) {
      stdout.write(
        `- ${candidate.name} type=${candidate.sessionType ?? 'unknown'} creator=${formatCreatorLabel(candidate.creator)} lifecycle=${candidate.lifecycle ?? 'unknown'} age=${formatAgeMs(candidate.ageMs)} reason=${candidate.reason ?? 'unknown'}\n`,
      )
    }
    return 0
  }

  stdout.write(`Sweep complete: automation=${automation} nonHuman=${nonHuman}\n`)
  return 0
}

async function runSend(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: SendOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/agents/sessions/${encodeURIComponent(options.sessionName)}/send`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ text: options.text }),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const payload = isObject(result.data) ? result.data : {}
  const sent = typeof payload.sent === 'boolean' ? payload.sent : false
  stdout.write(`sent: ${sent}\n`)

  return 0
}

export async function runWorkersCli(
  args: readonly string[],
  dependencies: WorkersCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const readConfig = dependencies.readConfig ?? readHerdConfig

  const command = args[0]
  if (
    !command ||
    (command !== 'list' &&
      command !== 'cleanup' &&
      command !== 'dispatch' &&
      command !== 'kill' &&
      command !== 'status' &&
      command !== 'send')
  ) {
    printUsage(stdout)
    return 1
  }

  const config = await readConfig()
  if (!config) {
    stderr.write('Herd config not found. Run `herd onboard` first.\n')
    return 1
  }

  if (command === 'list') {
    const listOptions = parseListOptions(args.slice(1))
    if (!listOptions) {
      printUsage(stdout)
      return 1
    }
    return runList(config, fetchImpl, listOptions, stdout, stderr)
  }

  if (command === 'cleanup') {
    const cleanupOptions = parseCleanupOptions(args.slice(1))
    if (!cleanupOptions) {
      printUsage(stdout)
      return 1
    }
    return runCleanup(config, fetchImpl, cleanupOptions, stdout, stderr)
  }

  if (command === 'dispatch') {
    const dispatchOptions = parseDispatchOptions(args.slice(1))
    if (!dispatchOptions) {
      printUsage(stdout)
      return 1
    }

    if (dispatchOptions.agentType && !dispatchOptions.skipValidation) {
      try {
        const { providers } = await loadProviderRegistry(config, { fetchImpl })
        const validAgentTypes = new Set(listWorkerDispatchProviderIds(providers))
        if (!validAgentTypes.has(dispatchOptions.agentType)) {
          stderr.write(
            `Invalid --agent "${dispatchOptions.agentType}". Expected one of: ${[...validAgentTypes].join(', ')}.\n`,
          )
          return 1
        }
      } catch {
        stderr.write('Cannot validate --agent without a running Herd server. Start the server first or pass --skip-validation.\n')
        return 1
      }
    }

    return runDispatch(config, fetchImpl, dispatchOptions, stdout, stderr)
  }

  if (command === 'kill') {
    const sessionName = parseSessionName(args[1])
    if (!sessionName || args.length !== 2) {
      printUsage(stdout)
      return 1
    }
    return runKill(config, fetchImpl, sessionName, stdout, stderr)
  }

  if (command === 'status') {
    const statusOptions = parseSessionPeekCommandArgs(args.slice(1))
    if (!statusOptions) {
      printUsage(stdout)
      return 1
    }
    return runStatus(
      config,
      fetchImpl,
      statusOptions.sessionName,
      { tail: statusOptions.tail, json: statusOptions.json },
      stdout,
      stderr,
    )
  }

  const sendOptions = parseSendOptions(args.slice(1))
  if (!sendOptions) {
    printUsage(stdout)
    return 1
  }

  return runSend(config, fetchImpl, sendOptions, stdout, stderr)
}
