import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HerdConfig, normalizeEndpoint, readHerdConfig } from './config.js'
import { fetchJson as fetchJsonStrict } from './http-json.js'
import {
  type ConversationStatus,
  type ConversationSurface,
} from './session-contract.js'

interface Writable {
  write(chunk: string): boolean
}

interface ConversationSummary {
  id: string
  commanderId: string
  surface: ConversationSurface
  status: ConversationStatus
  liveSession: Record<string, unknown> | null
}

interface ListOptions {
  commanderId: string
}

interface CreateOptions {
  commanderId: string
  surface: 'ui' | 'cli' | 'api'
}

interface MessagesOptions {
  conversationId: string
  tail: number
  before?: number
  json: boolean
}

interface ConversationMessage {
  id?: string
  kind: string
  text: string
  timestamp?: string
  [key: string]: unknown
}

interface ConversationMessagesPage {
  conversationId: string
  sessionName?: string
  source?: string
  limit?: number
  before: string | null
  nextBefore: string | null
  hasMore: boolean
  totalMessages?: number
  messages: ConversationMessage[]
}

export interface ConversationsCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HerdConfig | null>
  stdout?: Writable
  stderr?: Writable
}

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const AGENT_RUNTIME_CONVERSATION_CREATE_ENV_KEYS = [
  'HERD_SESSION_NAME',
  'HERD_CONVERSATION_ID',
  'HERD_COMMANDER_RUNTIME_CONVERSATION_ID',
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  herd conversations list --commander <id>\n')
  stdout.write('  herd conversations create --commander <id> --surface <ui|cli|api>\n')
  stdout.write('  herd conversations messages <conversation-id> [--tail <count>] [--before <cursor>] [--json]\n')
  stdout.write('  herd conversations attach <conversation-id>\n')
  stdout.write('  herd conversations archive <conversation-id>\n')
}

function parseNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function parseConversationId(value: string | undefined): string | null {
  const trimmed = parseNonEmpty(value)
  if (!trimmed || !CONVERSATION_ID_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

function parsePositiveInteger(value: string | undefined): number | null {
  const trimmed = parseNonEmpty(value)
  if (!trimmed || !/^\d+$/u.test(trimmed)) {
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  const trimmed = parseNonEmpty(value)
  if (!trimmed || !/^\d+$/u.test(trimmed)) {
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseListOptions(args: readonly string[]): ListOptions | null {
  if (args.length !== 2 || args[0] !== '--commander') {
    return null
  }

  const commanderId = parseNonEmpty(args[1])
  if (!commanderId) {
    return null
  }

  return { commanderId }
}

function parseCreateSurface(value: string | undefined): CreateOptions['surface'] | null {
  return value === 'ui' || value === 'cli' || value === 'api' ? value : null
}

function parseCreateOptions(args: readonly string[]): CreateOptions | null {
  let commanderId: string | null = null
  let surface: CreateOptions['surface'] | null = null

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]

    if (flag === '--commander') {
      commanderId = parseNonEmpty(value)
      continue
    }

    if (flag === '--surface') {
      surface = parseCreateSurface(parseNonEmpty(value) ?? undefined)
      continue
    }

    return null
  }

  if (!commanderId || !surface || args.length !== 4) {
    return null
  }

  return { commanderId, surface }
}

function parseMessagesOptions(args: readonly string[]): MessagesOptions | null {
  const conversationId = parseConversationId(args[0])
  if (!conversationId) {
    return null
  }

  let tail = 40
  let before: number | undefined
  let json = false
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--json') {
      json = true
      continue
    }

    if (flag === '--tail') {
      const parsed = parsePositiveInteger(args[index + 1])
      if (parsed === null) {
        return null
      }
      tail = parsed
      index += 1
      continue
    }

    if (flag === '--before') {
      const parsed = parseNonNegativeInteger(args[index + 1])
      if (parsed === null) {
        return null
      }
      before = parsed
      index += 1
      continue
    }

    return null
  }

  return {
    conversationId,
    tail,
    ...(before !== undefined ? { before } : {}),
    json,
  }
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

function activeAgentRuntimeContextEnvKey(): string | null {
  for (const key of AGENT_RUNTIME_CONVERSATION_CREATE_ENV_KEYS) {
    if ((process.env[key] ?? '').trim().length > 0) {
      return key
    }
  }
  return null
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

function parseConversationSurface(value: unknown): ConversationSurface | null {
  return value === 'discord' ||
    value === 'telegram' ||
    value === 'whatsapp' ||
    value === 'ui' ||
    value === 'cli' ||
    value === 'api'
    ? value
    : null
}

function parseConversationStatus(value: unknown): ConversationStatus | null {
  return value === 'active' || value === 'idle' || value === 'archived' ? value : null
}

function parseConversation(payload: unknown): ConversationSummary | null {
  if (!isObject(payload)) {
    return null
  }

  const id = parseNonEmpty(typeof payload.id === 'string' ? payload.id : undefined)
  const commanderId = parseNonEmpty(
    typeof payload.commanderId === 'string' ? payload.commanderId : undefined,
  )
  const surface = parseConversationSurface(payload.surface)
  const status = parseConversationStatus(payload.status)

  if (!id || !commanderId || !surface || !status) {
    return null
  }

  const liveSession = isObject(payload.liveSession) ? payload.liveSession : null
  return {
    id,
    commanderId,
    surface,
    status,
    liveSession,
  }
}

function parseConversationList(payload: unknown): ConversationSummary[] {
  const raw = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.conversations) ? payload.conversations : [])

  const conversations: ConversationSummary[] = []
  for (const entry of raw) {
    const parsed = parseConversation(entry)
    if (parsed) {
      conversations.push(parsed)
    }
  }

  return conversations
}

function parseConversationMessage(payload: unknown): ConversationMessage | null {
  if (!isObject(payload)) {
    return null
  }

  const kind = parseNonEmpty(typeof payload.kind === 'string' ? payload.kind : undefined)
  const text = typeof payload.text === 'string' ? payload.text : null
  if (!kind || text === null) {
    return null
  }

  return {
    ...payload,
    kind,
    text,
  }
}

function parseConversationMessagesPage(payload: unknown): ConversationMessagesPage | null {
  if (!isObject(payload) || !Array.isArray(payload.messages)) {
    return null
  }

  const conversationId = parseNonEmpty(typeof payload.conversationId === 'string' ? payload.conversationId : undefined)
  if (!conversationId) {
    return null
  }

  const messages = payload.messages
    .map((message) => parseConversationMessage(message))
    .filter((message): message is ConversationMessage => message !== null)
  if (messages.length !== payload.messages.length) {
    return null
  }

  return {
    conversationId,
    ...(typeof payload.sessionName === 'string' ? { sessionName: payload.sessionName } : {}),
    ...(typeof payload.source === 'string' ? { source: payload.source } : {}),
    ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
    before: typeof payload.before === 'string' ? payload.before : null,
    nextBefore: typeof payload.nextBefore === 'string' ? payload.nextBefore : null,
    hasMore: payload.hasMore === true,
    ...(typeof payload.totalMessages === 'number' ? { totalMessages: payload.totalMessages } : {}),
    messages,
  }
}

async function resolveConfig(
  dependencies: ConversationsCliDependencies,
  stderr: Writable,
): Promise<HerdConfig | null> {
  const readConfig = dependencies.readConfig ?? readHerdConfig
  const config = await readConfig()
  if (!config) {
    stderr.write('Herd config not found. Run `herd onboard` first.\n')
    return null
  }

  return config
}

async function runList(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: ListOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/conversations`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversations = parseConversationList(result.data)
  if (conversations.length === 0) {
    stdout.write('No conversations.\n')
    return 0
  }

  stdout.write('Conversations:\n')
  for (const conversation of conversations) {
    const live = conversation.liveSession ? 'yes' : 'no'
    stdout.write(
      `- ${conversation.id} surface=${conversation.surface} status=${conversation.status} live=${live}\n`,
    )
  }

  return 0
}

async function runCreate(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: CreateOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const runtimeEnvKey = activeAgentRuntimeContextEnvKey()
  if (runtimeEnvKey) {
    stderr.write(
      `Refusing to create a conversation from an agent runtime context (${runtimeEnvKey} is set). Conversation creation is operator-controlled.\n`,
    )
    return 1
  }

  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/conversations`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ surface: options.surface }),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversation = parseConversation(result.data)
  if (!conversation) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  stdout.write(`${conversation.id}\n`)
  return 0
}

function buildMessagesUrl(config: HerdConfig, options: {
  conversationId: string
  limit: number
  before?: number
}): string {
  const url = new URL(
    buildApiUrl(config.endpoint, `/api/conversations/${encodeURIComponent(options.conversationId)}/messages`),
  )
  url.searchParams.set('limit', String(options.limit))
  if (options.before !== undefined) {
    url.searchParams.set('before', String(options.before))
  }
  return url.toString()
}

async function fetchConversationMessagesPage(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: {
    conversationId: string
    limit: number
    before?: number
  },
  stderr: Writable,
): Promise<ConversationMessagesPage | null> {
  const result = await fetchJson(fetchImpl, buildMessagesUrl(config, options), {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return null
  }

  const page = parseConversationMessagesPage(result.data)
  if (!page) {
    stderr.write('Request succeeded but response was malformed.\n')
    return null
  }

  return page
}

function roleForMessageKind(kind: string): string {
  return kind === 'agent' ? 'assistant' : kind
}

function indentMultiline(text: string): string {
  return text.split(/\r?\n/u).map((line) => `  ${line}`).join('\n')
}

function writeTextMessages(stdout: Writable, messages: readonly ConversationMessage[]): void {
  if (messages.length === 0) {
    stdout.write('No messages.\n')
    return
  }

  for (const message of messages) {
    const role = roleForMessageKind(message.kind)
    if (message.text.includes('\n')) {
      stdout.write(`${role}:\n${indentMultiline(message.text)}\n`)
    } else {
      stdout.write(`${role}: ${message.text}\n`)
    }
  }
}

async function runMessages(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  options: MessagesOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const pages: ConversationMessagesPage[] = []
  let remaining = options.tail
  let before = options.before

  while (remaining > 0) {
    const limit = Math.min(remaining, 100)
    const page = await fetchConversationMessagesPage(
      config,
      fetchImpl,
      {
        conversationId: options.conversationId,
        limit,
        ...(before !== undefined ? { before } : {}),
      },
      stderr,
    )
    if (!page) {
      return 1
    }

    pages.push(page)
    remaining -= page.messages.length
    if (!page.hasMore || !page.nextBefore || page.messages.length === 0) {
      break
    }

    before = Number.parseInt(page.nextBefore, 10)
    if (!Number.isSafeInteger(before)) {
      break
    }
  }

  const messages = pages
    .slice()
    .reverse()
    .flatMap((page) => page.messages)
  const lastPage = pages.at(-1)
  const payload = {
    conversationId: options.conversationId,
    sessionName: pages[0]?.sessionName,
    source: pages[0]?.source,
    requestedTail: options.tail,
    before: options.before !== undefined ? String(options.before) : null,
    nextBefore: lastPage?.nextBefore ?? null,
    hasMore: lastPage?.hasMore ?? false,
    totalMessages: lastPage?.totalMessages ?? pages[0]?.totalMessages,
    messages,
  }

  if (options.json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  } else {
    writeTextMessages(stdout, messages)
  }

  return 0
}

async function runAttach(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  conversationId: string,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/conversations/${encodeURIComponent(conversationId)}/resume`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversation = parseConversation(result.data)
  if (!conversation) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  stdout.write(`Conversation ${conversation.id} attached.\n`)
  return 0
}

async function runArchive(
  config: HerdConfig,
  fetchImpl: typeof fetch,
  conversationId: string,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/conversations/${encodeURIComponent(conversationId)}/archive`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversation = parseConversation(result.data)
  if (!conversation) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  stdout.write(`Conversation ${conversation.id} archived.\n`)
  return 0
}

export async function runConversationsCli(
  args: readonly string[],
  dependencies: ConversationsCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch

  const command = args[0]
  if (
    !command ||
    (command !== 'list' &&
      command !== 'create' &&
      command !== 'messages' &&
      command !== 'attach' &&
      command !== 'archive')
  ) {
    printUsage(stdout)
    return 1
  }

  const config = await resolveConfig(dependencies, stderr)
  if (!config) {
    return 1
  }

  if (command === 'list') {
    const options = parseListOptions(args.slice(1))
    if (!options) {
      printUsage(stdout)
      return 1
    }
    return runList(config, fetchImpl, options, stdout, stderr)
  }

  if (command === 'create') {
    const options = parseCreateOptions(args.slice(1))
    if (!options) {
      printUsage(stdout)
      return 1
    }
    return runCreate(config, fetchImpl, options, stdout, stderr)
  }

  if (command === 'messages') {
    const options = parseMessagesOptions(args.slice(1))
    if (!options) {
      printUsage(stdout)
      return 1
    }
    return runMessages(config, fetchImpl, options, stdout, stderr)
  }

  const conversationId = parseConversationId(args[1])
  if (!conversationId || args.length !== 2) {
    printUsage(stdout)
    return 1
  }

  if (command === 'attach') {
    return runAttach(config, fetchImpl, conversationId, stdout, stderr)
  }

  return runArchive(config, fetchImpl, conversationId, stdout, stderr)
}
