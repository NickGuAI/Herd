import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { WebSocket, RawData } from 'ws'
import {
  buildDaemonWelcomeMessage,
  type DaemonKillMessage,
  HAMMURABI_DAEMON_PROTOCOL_VERSION,
  parseDaemonClientMessage,
  type DaemonResizeMessage,
  type DaemonSpawnMessage,
  type DaemonStdinMessage,
  type DaemonProviderHealth,
} from './protocol.js'
import type { PersistedDaemonProcess, PtyHandle } from '../types.js'

export const DEFAULT_DAEMON_HEARTBEAT_INTERVAL_MS = 15_000

export interface DaemonConnectionSnapshot {
  machineId: string
  connectionId: string
  connectedAt: string
  lastSeenAt: string
  daemonVersion: string | null
  protocolVersion: number
  pid: number | null
  platform: string | null
  arch: string | null
  activeProcesses: number | null
  providerHealth: Record<string, DaemonProviderHealth>
}

interface DaemonConnectionState extends DaemonConnectionSnapshot {
  socket: WebSocket
}

export interface DaemonPipeSpawnOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface DaemonPtySpawnOptions extends DaemonPipeSpawnOptions {
  cols?: number
  rows?: number
}

type DaemonProcessEntry =
  | { kind: 'pipe'; process: DaemonChildProcess }
  | { kind: 'pty'; pty: DaemonPtyHandle }

const DAEMON_PROCESS_METADATA = Symbol.for('hammurabi.daemonProcess')

type DaemonProcessCarrier = {
  [DAEMON_PROCESS_METADATA]?: PersistedDaemonProcess
}

function normalizeEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> | undefined {
  if (!env) {
    return undefined
  }
  const entries = Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

class DaemonChildStdin extends Writable {
  constructor(
    private readonly writeChunk: (data: string) => void,
  ) {
    super()
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      this.writeChunk(Buffer.isBuffer(chunk) ? chunk.toString() : Buffer.from(chunk, encoding).toString())
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

class DaemonChildProcess extends EventEmitter {
  pid = 0
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable

  constructor(
    private readonly processId: string,
    private readonly sendStdin: (processId: string, data: string) => void,
    private readonly sendKill: (processId: string, signal?: string) => void,
  ) {
    super()
    this.stdin = new DaemonChildStdin((data) => this.sendStdin(this.processId, data))
    Object.defineProperty(this, DAEMON_PROCESS_METADATA, {
      value: { processId, mode: 'pipe' },
    })
  }

  setSpawned(pid: number | null): void {
    if (typeof pid === 'number' && Number.isFinite(pid)) {
      this.pid = pid
    }
  }

  emitStdout(data: string): void {
    if (!this.stdout.destroyed) {
      this.stdout.write(data)
    }
  }

  emitStderr(data: string): void {
    if (!this.stderr.destroyed) {
      this.stderr.write(data)
    }
  }

  emitProcessError(error: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error)
      return
    }
    this.emitStderr(`${error.message}\n`)
  }

  emitExit(exitCode: number | null, signal: string | null): void {
    if (this.exitCode !== null || this.signalCode !== null) {
      return
    }
    this.exitCode = typeof exitCode === 'number' ? exitCode : null
    this.signalCode = signal as NodeJS.Signals | null
    this.stdout.end()
    this.stderr.end()
    this.stdin.end()
    this.emit('exit', this.exitCode, this.signalCode)
    this.emit('close', this.exitCode, this.signalCode)
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.sendKill(this.processId, typeof signal === 'string' ? signal : undefined)
    return true
  }
}

class DaemonPtyHandle implements PtyHandle {
  pid = 0
  private exited = false
  private readonly dataCallbacks = new Set<(data: string) => void>()
  private readonly exitCallbacks = new Set<(e: { exitCode: number; signal?: number }) => void>()

  constructor(
    private readonly processId: string,
    private readonly sendStdin: (processId: string, data: string) => void,
    private readonly sendResize: (processId: string, cols: number, rows: number) => void,
    private readonly sendKill: (processId: string, signal?: string) => void,
  ) {}

  setSpawned(pid: number | null): void {
    if (typeof pid === 'number' && Number.isFinite(pid)) {
      this.pid = pid
    }
  }

  onData(cb: (data: string) => void): { dispose(): void } {
    this.dataCallbacks.add(cb)
    return {
      dispose: () => {
        this.dataCallbacks.delete(cb)
      },
    }
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitCallbacks.add(cb)
    return {
      dispose: () => {
        this.exitCallbacks.delete(cb)
      },
    }
  }

  write(data: string): void {
    this.sendStdin(this.processId, data)
  }

  resize(cols: number, rows: number): void {
    this.sendResize(this.processId, cols, rows)
  }

  kill(signal?: string): void {
    this.sendKill(this.processId, signal)
  }

  emitData(data: string): void {
    if (this.exited) {
      return
    }
    for (const cb of this.dataCallbacks) {
      cb(data)
    }
  }

  emitError(error: Error): void {
    this.emitData(`\r\n[daemon error] ${error.message}\r\n`)
  }

  emitExit(exitCode: number | null): void {
    if (this.exited) {
      return
    }
    this.exited = true
    for (const cb of this.exitCallbacks) {
      cb({ exitCode: typeof exitCode === 'number' ? exitCode : 1 })
    }
    this.dataCallbacks.clear()
    this.exitCallbacks.clear()
  }
}

export function getDaemonProcessMetadata(process: ChildProcess | null | undefined): PersistedDaemonProcess | undefined {
  if (!process) {
    return undefined
  }
  const metadata = (process as unknown as DaemonProcessCarrier)[DAEMON_PROCESS_METADATA]
  return metadata
    ? { ...metadata }
    : undefined
}

export function createDaemonPairingToken(): string {
  return `hmrd_${randomBytes(24).toString('base64url')}`
}

export function hashDaemonPairingToken(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('base64url')
}

export function verifyDaemonPairingToken(token: string, expectedHash: string | undefined): boolean {
  const normalizedToken = token.trim()
  const normalizedHash = expectedHash?.trim()
  if (!normalizedToken || !normalizedHash) {
    return false
  }

  const actual = Buffer.from(hashDaemonPairingToken(normalizedToken), 'utf8')
  const expected = Buffer.from(normalizedHash, 'utf8')
  if (actual.length !== expected.length) {
    return false
  }
  return timingSafeEqual(actual, expected)
}

export class MachineDaemonRegistry {
  private readonly connections = new Map<string, DaemonConnectionState>()
  private readonly processMachineIds = new Map<string, string>()
  private readonly processes = new Map<string, DaemonProcessEntry>()
  private readonly spawnRequests = new Map<string, string>()
  private readonly heartbeatIntervalMs: number

  constructor(options: { heartbeatIntervalMs?: number } = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_DAEMON_HEARTBEAT_INTERVAL_MS
  }

  private send(machineId: string, message: DaemonSpawnMessage | DaemonStdinMessage | DaemonResizeMessage | DaemonKillMessage): void {
    const connection = this.connections.get(machineId)
    if (!connection || connection.socket.readyState !== connection.socket.OPEN) {
      throw new Error(`Daemon machine "${machineId}" is not connected`)
    }
    connection.socket.send(JSON.stringify(message))
  }

  private registerProcess(
    machineId: string,
    processId: string,
    requestId: string,
    entry: DaemonProcessEntry,
  ): void {
    this.processMachineIds.set(processId, machineId)
    this.processes.set(processId, entry)
    this.spawnRequests.set(requestId, processId)
  }

  private forgetProcess(processId: string): void {
    this.processMachineIds.delete(processId)
    this.processes.delete(processId)
    for (const [requestId, mappedProcessId] of this.spawnRequests.entries()) {
      if (mappedProcessId === processId) {
        this.spawnRequests.delete(requestId)
      }
    }
  }

  spawnProcess(machineId: string, options: DaemonPipeSpawnOptions): ChildProcess {
    const processId = randomUUID()
    const requestId = randomUUID()
    const child = new DaemonChildProcess(
      processId,
      (targetProcessId, data) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'stdin', processId: targetProcessId, data })
        }
      },
      (targetProcessId, signal) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'kill', processId: targetProcessId, ...(signal ? { signal } : {}) })
        }
      },
    )
    this.registerProcess(machineId, processId, requestId, { kind: 'pipe', process: child })
    this.send(machineId, {
      type: 'spawn',
      requestId,
      processId,
      mode: 'pipe',
      command: options.command,
      args: options.args ?? [],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(normalizeEnv(options.env) ? { env: normalizeEnv(options.env)! } : {}),
    })
    return child as unknown as ChildProcess
  }

  attachProcess(machineId: string, metadata: PersistedDaemonProcess): ChildProcess {
    const existing = this.processes.get(metadata.processId)
    if (existing?.kind === 'pipe') {
      return existing.process as unknown as ChildProcess
    }
    if (metadata.mode !== 'pipe') {
      throw new Error(`Cannot attach daemon ${metadata.mode} process "${metadata.processId}" as a stream child process`)
    }
    const child = new DaemonChildProcess(
      metadata.processId,
      (targetProcessId, data) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'stdin', processId: targetProcessId, data })
        }
      },
      (targetProcessId, signal) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'kill', processId: targetProcessId, ...(signal ? { signal } : {}) })
        }
      },
    )
    this.registerProcess(machineId, metadata.processId, `restored:${metadata.processId}`, { kind: 'pipe', process: child })
    return child as unknown as ChildProcess
  }

  spawnPty(machineId: string, options: DaemonPtySpawnOptions): PtyHandle {
    const processId = randomUUID()
    const requestId = randomUUID()
    const pty = new DaemonPtyHandle(
      processId,
      (targetProcessId, data) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'stdin', processId: targetProcessId, data })
        }
      },
      (targetProcessId, cols, rows) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'resize', processId: targetProcessId, cols, rows })
        }
      },
      (targetProcessId, signal) => {
        const targetMachineId = this.processMachineIds.get(targetProcessId)
        if (targetMachineId) {
          this.send(targetMachineId, { type: 'kill', processId: targetProcessId, ...(signal ? { signal } : {}) })
        }
      },
    )
    this.registerProcess(machineId, processId, requestId, { kind: 'pty', pty })
    this.send(machineId, {
      type: 'spawn',
      requestId,
      processId,
      mode: 'pty',
      command: options.command,
      args: options.args ?? [],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(normalizeEnv(options.env) ? { env: normalizeEnv(options.env)! } : {}),
      ...(typeof options.cols === 'number' ? { cols: options.cols } : {}),
      ...(typeof options.rows === 'number' ? { rows: options.rows } : {}),
    })
    return pty
  }

  attach(machineId: string, socket: WebSocket): DaemonConnectionSnapshot {
    this.detach(machineId, 'Superseded by a newer daemon connection')

    const connectedAt = new Date().toISOString()
    const connection: DaemonConnectionState = {
      machineId,
      connectionId: randomUUID(),
      connectedAt,
      lastSeenAt: connectedAt,
      daemonVersion: null,
      protocolVersion: HAMMURABI_DAEMON_PROTOCOL_VERSION,
      pid: null,
      platform: null,
      arch: null,
      activeProcesses: null,
      providerHealth: {},
      socket,
    }
    this.connections.set(machineId, connection)

    socket.send(JSON.stringify(buildDaemonWelcomeMessage({
      machineId,
      connectionId: connection.connectionId,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    })))

    socket.on('message', (raw: RawData) => {
      const parsed = parseDaemonClientMessage(raw)
      if (!parsed) {
        socket.close(1003, 'Invalid daemon protocol message')
        return
      }

      const liveConnection = this.connections.get(machineId)
      if (!liveConnection || liveConnection.connectionId !== connection.connectionId) {
        return
      }

      const now = new Date().toISOString()
      liveConnection.lastSeenAt = now

      if (parsed.type === 'hello') {
        if (parsed.machineId !== machineId) {
          socket.close(1008, 'Daemon machine id mismatch')
          return
        }
        liveConnection.daemonVersion = parsed.daemonVersion
        liveConnection.pid = parsed.pid
        liveConnection.platform = parsed.platform
        liveConnection.arch = parsed.arch
        liveConnection.providerHealth = parsed.providerHealth
        return
      }

      if (parsed.type === 'heartbeat') {
        liveConnection.activeProcesses = parsed.activeProcesses
        if (Object.keys(parsed.providerHealth).length > 0) {
          liveConnection.providerHealth = parsed.providerHealth
        }
        return
      }

      if (parsed.type === 'spawned') {
        const processId = this.spawnRequests.get(parsed.requestId)
        if (processId !== parsed.processId) {
          return
        }
        const entry = this.processes.get(parsed.processId)
        if (entry?.kind === 'pipe') {
          entry.process.setSpawned(parsed.pid)
        } else if (entry?.kind === 'pty') {
          entry.pty.setSpawned(parsed.pid)
        }
        return
      }

      if (parsed.type === 'stdout') {
        const entry = this.processes.get(parsed.processId)
        if (entry?.kind === 'pipe') {
          entry.process.emitStdout(parsed.data)
        }
        return
      }

      if (parsed.type === 'stderr') {
        const entry = this.processes.get(parsed.processId)
        if (entry?.kind === 'pipe') {
          entry.process.emitStderr(parsed.data)
        } else if (entry?.kind === 'pty') {
          entry.pty.emitData(parsed.data)
        }
        return
      }

      if (parsed.type === 'pty-data') {
        const entry = this.processes.get(parsed.processId)
        if (entry?.kind === 'pty') {
          entry.pty.emitData(parsed.data)
        }
        return
      }

      if (parsed.type === 'exit') {
        const entry = this.processes.get(parsed.processId)
        if (entry?.kind === 'pipe') {
          entry.process.emitExit(parsed.exitCode, parsed.signal)
        } else if (entry?.kind === 'pty') {
          entry.pty.emitExit(parsed.exitCode)
        }
        this.forgetProcess(parsed.processId)
        return
      }

      if (parsed.type === 'error') {
        const processId = parsed.processId ?? (parsed.requestId ? this.spawnRequests.get(parsed.requestId) : null)
        if (!processId) {
          return
        }
        const entry = this.processes.get(processId)
        const error = new Error(parsed.message)
        if (entry?.kind === 'pipe') {
          entry.process.emitProcessError(error)
        } else if (entry?.kind === 'pty') {
          entry.pty.emitError(error)
          entry.pty.emitExit(1)
        }
        this.forgetProcess(processId)
      }
    })

    const removeIfCurrent = () => {
      const liveConnection = this.connections.get(machineId)
      if (liveConnection?.connectionId === connection.connectionId) {
        this.connections.delete(machineId)
      }
    }
    socket.on('close', removeIfCurrent)
    socket.on('error', removeIfCurrent)

    return this.getConnection(machineId)!
  }

  getConnection(machineId: string): DaemonConnectionSnapshot | null {
    const connection = this.connections.get(machineId)
    if (!connection) {
      return null
    }
    const { socket: _socket, ...snapshot } = connection
    return {
      ...snapshot,
      providerHealth: { ...snapshot.providerHealth },
    }
  }

  detach(machineId: string, reason = 'Daemon transport detached'): void {
    const connection = this.connections.get(machineId)
    if (!connection) {
      return
    }
    this.connections.delete(machineId)
    try {
      connection.socket.close(1000, reason)
    } catch {
      try {
        connection.socket.terminate()
      } catch {
        // Best effort.
      }
    }
  }

  disconnect(machineId: string, reason = 'Daemon disconnected'): void {
    const connection = this.connections.get(machineId)
    this.connections.delete(machineId)
    for (const [processId, processMachineId] of this.processMachineIds.entries()) {
      if (processMachineId !== machineId) {
        continue
      }
      if (connection && connection.socket.readyState === connection.socket.OPEN) {
        try {
          connection.socket.send(JSON.stringify({ type: 'kill', processId }))
        } catch {
          // The local session state is still retired below; the daemon may already be gone.
        }
      }
      const entry = this.processes.get(processId)
      const error = new Error(reason)
      if (entry?.kind === 'pipe') {
        entry.process.emitProcessError(error)
        entry.process.emitExit(1, null)
      } else if (entry?.kind === 'pty') {
        entry.pty.emitError(error)
        entry.pty.emitExit(1)
      }
      this.forgetProcess(processId)
    }
    if (connection) {
      try {
        connection.socket.close(1000, reason)
      } catch {
        try {
          connection.socket.terminate()
        } catch {
          // Best effort.
        }
      }
    }
  }

  shutdown(): void {
    for (const machineId of this.connections.keys()) {
      this.detach(machineId, 'Hammurabi server shutting down')
    }
  }
}
