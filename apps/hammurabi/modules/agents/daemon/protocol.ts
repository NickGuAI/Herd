import { Buffer } from 'node:buffer'

export const HAMMURABI_DAEMON_PROTOCOL_VERSION = 1

export type DaemonClientMessage =
  | DaemonHelloMessage
  | DaemonHeartbeatMessage
  | DaemonPongMessage
  | DaemonSpawnedMessage
  | DaemonStdoutMessage
  | DaemonStderrMessage
  | DaemonPtyDataMessage
  | DaemonExitMessage
  | DaemonErrorMessage

export type DaemonServerMessage =
  | DaemonSpawnMessage
  | DaemonStdinMessage
  | DaemonResizeMessage
  | DaemonKillMessage

export type DaemonSpawnMode = 'pipe' | 'pty'

export interface DaemonProviderHealth {
  provider: string
  installed: boolean
  authenticated: boolean
  version: string | null
  authMethod: string | null
  detail: string | null
  checkedAt: string | null
}

export interface DaemonHelloMessage {
  type: 'hello'
  protocolVersion: typeof HAMMURABI_DAEMON_PROTOCOL_VERSION
  machineId: string
  daemonVersion: string
  pid: number | null
  platform: string | null
  arch: string | null
  providerHealth: Record<string, DaemonProviderHealth>
}

export interface DaemonHeartbeatMessage {
  type: 'heartbeat'
  sequence: number
  providerHealth: Record<string, DaemonProviderHealth>
  activeProcesses: number | null
}

export interface DaemonPongMessage {
  type: 'pong'
  sequence: number | null
}

export interface DaemonSpawnedMessage {
  type: 'spawned'
  requestId: string
  processId: string
  pid: number | null
}

export interface DaemonStdoutMessage {
  type: 'stdout'
  processId: string
  data: string
}

export interface DaemonStderrMessage {
  type: 'stderr'
  processId: string
  data: string
}

export interface DaemonPtyDataMessage {
  type: 'pty-data'
  processId: string
  data: string
}

export interface DaemonExitMessage {
  type: 'exit'
  processId: string
  exitCode: number | null
  signal: string | null
}

export interface DaemonErrorMessage {
  type: 'error'
  requestId: string | null
  processId: string | null
  message: string
}

export interface DaemonWelcomeMessage {
  type: 'welcome'
  protocolVersion: typeof HAMMURABI_DAEMON_PROTOCOL_VERSION
  machineId: string
  connectionId: string
  heartbeatIntervalMs: number
  acceptedAt: string
}

export function buildDaemonWelcomeMessage(input: {
  machineId: string
  connectionId: string
  heartbeatIntervalMs: number
  acceptedAt?: Date
}): DaemonWelcomeMessage {
  return {
    type: 'welcome',
    protocolVersion: HAMMURABI_DAEMON_PROTOCOL_VERSION,
    machineId: input.machineId,
    connectionId: input.connectionId,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    acceptedAt: (input.acceptedAt ?? new Date()).toISOString(),
  }
}

export interface DaemonSpawnMessage {
  type: 'spawn'
  requestId: string
  processId: string
  mode: DaemonSpawnMode
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export interface DaemonStdinMessage {
  type: 'stdin'
  processId: string
  data: string
}

export interface DaemonResizeMessage {
  type: 'resize'
  processId: string
  cols: number
  rows: number
}

export interface DaemonKillMessage {
  type: 'kill'
  processId: string
  signal?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readObjectMessage(raw: unknown): Record<string, unknown> | null {
  if (Buffer.isBuffer(raw)) {
    return readObjectMessage(raw.toString('utf8'))
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return isObject(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isObject(raw) ? raw : null
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      return null
    }
    result.push(item)
  }
  return result
}

function readEnvRecord(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const entries: Array<[string, string]> = []
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string') {
      entries.push([key, entryValue])
    }
  }
  return Object.fromEntries(entries)
}

function parseProviderHealthEntry(
  provider: string,
  value: unknown,
): DaemonProviderHealth | null {
  if (!isObject(value)) {
    return null
  }

  return {
    provider,
    installed: value.installed === true,
    authenticated: value.authenticated === true || value.configured === true,
    version: readNullableString(value.version),
    authMethod: readNullableString(value.authMethod ?? value.method),
    detail: readNullableString(value.detail ?? value.reason),
    checkedAt: readNullableString(value.checkedAt),
  }
}

function parseProviderHealth(value: unknown): Record<string, DaemonProviderHealth> {
  if (!isObject(value)) {
    return {}
  }

  const entries: Array<[string, DaemonProviderHealth]> = []
  for (const [rawProvider, rawStatus] of Object.entries(value)) {
    const provider = rawProvider.trim()
    if (!provider) {
      continue
    }
    const status = parseProviderHealthEntry(provider, rawStatus)
    if (status) {
      entries.push([provider, status])
    }
  }
  return Object.fromEntries(entries)
}

function parseHello(record: Record<string, unknown>): DaemonHelloMessage | null {
  if (record.protocolVersion !== HAMMURABI_DAEMON_PROTOCOL_VERSION) {
    return null
  }

  const machineId = readTrimmedString(record.machineId)
  const daemonVersion = readTrimmedString(record.daemonVersion)
  if (!machineId || !daemonVersion) {
    return null
  }

  return {
    type: 'hello',
    protocolVersion: HAMMURABI_DAEMON_PROTOCOL_VERSION,
    machineId,
    daemonVersion,
    pid: readNullableNumber(record.pid),
    platform: readNullableString(record.platform),
    arch: readNullableString(record.arch),
    providerHealth: parseProviderHealth(record.providerHealth ?? record.providers),
  }
}

function parseHeartbeat(record: Record<string, unknown>): DaemonHeartbeatMessage | null {
  const sequence = typeof record.sequence === 'number' && Number.isInteger(record.sequence) && record.sequence >= 0
    ? record.sequence
    : null
  if (sequence === null) {
    return null
  }

  return {
    type: 'heartbeat',
    sequence,
    providerHealth: parseProviderHealth(record.providerHealth ?? record.providers),
    activeProcesses: readNullableNumber(record.activeProcesses),
  }
}

function parsePong(record: Record<string, unknown>): DaemonPongMessage {
  const sequence = typeof record.sequence === 'number' && Number.isInteger(record.sequence) && record.sequence >= 0
    ? record.sequence
    : null
  return {
    type: 'pong',
    sequence,
  }
}

function parseSpawned(record: Record<string, unknown>): DaemonSpawnedMessage | null {
  const requestId = readTrimmedString(record.requestId)
  const processId = readTrimmedString(record.processId)
  if (!requestId || !processId) {
    return null
  }
  return {
    type: 'spawned',
    requestId,
    processId,
    pid: readNullableNumber(record.pid),
  }
}

function parseOutputMessage<T extends 'stdout' | 'stderr' | 'pty-data'>(
  type: T,
  record: Record<string, unknown>,
): { type: T; processId: string; data: string } | null {
  const processId = readTrimmedString(record.processId)
  if (!processId || typeof record.data !== 'string') {
    return null
  }
  return {
    type,
    processId,
    data: record.data,
  }
}

function parseExit(record: Record<string, unknown>): DaemonExitMessage | null {
  const processId = readTrimmedString(record.processId)
  if (!processId) {
    return null
  }
  const rawExitCode = record.exitCode
  const exitCode = rawExitCode === null || rawExitCode === undefined
    ? null
    : (typeof rawExitCode === 'number' && Number.isInteger(rawExitCode) ? rawExitCode : undefined)
  if (exitCode === undefined) {
    return null
  }
  return {
    type: 'exit',
    processId,
    exitCode,
    signal: readNullableString(record.signal),
  }
}

function parseError(record: Record<string, unknown>): DaemonErrorMessage | null {
  const message = readTrimmedString(record.message)
  if (!message) {
    return null
  }
  return {
    type: 'error',
    requestId: readNullableString(record.requestId),
    processId: readNullableString(record.processId),
    message,
  }
}

export function parseDaemonClientMessage(raw: unknown): DaemonClientMessage | null {
  const record = readObjectMessage(raw)
  if (!record) {
    return null
  }

  if (record.type === 'hello') {
    return parseHello(record)
  }
  if (record.type === 'heartbeat') {
    return parseHeartbeat(record)
  }
  if (record.type === 'pong') {
    return parsePong(record)
  }
  if (record.type === 'spawned') {
    return parseSpawned(record)
  }
  if (record.type === 'stdout') {
    return parseOutputMessage('stdout', record)
  }
  if (record.type === 'stderr') {
    return parseOutputMessage('stderr', record)
  }
  if (record.type === 'pty-data') {
    return parseOutputMessage('pty-data', record)
  }
  if (record.type === 'exit') {
    return parseExit(record)
  }
  if (record.type === 'error') {
    return parseError(record)
  }

  return null
}

export function parseDaemonServerMessage(raw: unknown): DaemonServerMessage | null {
  const record = readObjectMessage(raw)
  if (!record) {
    return null
  }

  if (record.type === 'spawn') {
    const requestId = readTrimmedString(record.requestId)
    const processId = readTrimmedString(record.processId)
    const command = readTrimmedString(record.command)
    const args = readStringArray(record.args)
    const mode = record.mode === 'pipe' || record.mode === 'pty' ? record.mode : null
    if (!requestId || !processId || !command || !args || !mode) {
      return null
    }
    const cols = readNullableNumber(record.cols)
    const rows = readNullableNumber(record.rows)
    return {
      type: 'spawn',
      requestId,
      processId,
      mode,
      command,
      args,
      ...(readNullableString(record.cwd) ? { cwd: readNullableString(record.cwd)! } : {}),
      ...(readEnvRecord(record.env) ? { env: readEnvRecord(record.env)! } : {}),
      ...(cols !== null ? { cols } : {}),
      ...(rows !== null ? { rows } : {}),
    }
  }

  if (record.type === 'stdin') {
    const processId = readTrimmedString(record.processId)
    if (!processId || typeof record.data !== 'string') {
      return null
    }
    return { type: 'stdin', processId, data: record.data }
  }

  if (record.type === 'resize') {
    const processId = readTrimmedString(record.processId)
    const cols = readNullableNumber(record.cols)
    const rows = readNullableNumber(record.rows)
    if (!processId || cols === null || rows === null) {
      return null
    }
    return { type: 'resize', processId, cols, rows }
  }

  if (record.type === 'kill') {
    const processId = readTrimmedString(record.processId)
    if (!processId) {
      return null
    }
    return {
      type: 'kill',
      processId,
      ...(readNullableString(record.signal) ? { signal: readNullableString(record.signal)! } : {}),
    }
  }

  return null
}
