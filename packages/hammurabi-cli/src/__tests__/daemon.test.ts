import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parseDaemonRunOptions, runDaemonCli } from '../daemon.js'

interface BufferWriter {
  writer: { write: (chunk: string) => boolean }
  read: () => string
}

function createBufferWriter(): BufferWriter {
  let buffer = ''
  return {
    writer: {
      write(chunk: string): boolean {
        buffer += chunk
        return true
      },
    },
    read(): string {
      return buffer
    },
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

class FakeChildProcess extends EventEmitter {
  pid: number
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(): boolean {
    this.killed = true
    this.emit('exit', null, 'SIGTERM')
    this.emit('close', null, 'SIGTERM')
    return true
  }
}

class FakeDaemonWebSocket extends EventEmitter {
  static instances: FakeDaemonWebSocket[] = []
  readyState = 0
  sent: string[] = []
  url: string
  protocols: string | string[] | undefined

  constructor(url: string, protocols?: string | string[]) {
    super()
    this.url = url
    this.protocols = protocols
    FakeDaemonWebSocket.instances.push(this)
  }

  send(payload: string): void {
    this.sent.push(payload)
  }

  close(): void {
    if (this.readyState === 3) {
      return
    }
    this.readyState = 3
    this.emit('close', {})
  }

  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: Event | MessageEvent) => void,
    options?: { once?: boolean },
  ): void {
    const wrapped = (event: Event | MessageEvent) => listener(event)
    if (options?.once) {
      this.once(type, wrapped)
      return
    }
    this.on(type, wrapped)
  }

  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  message(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) })
  }
}

describe('daemon cli', () => {
  it('parses daemon run options', () => {
    expect(parseDaemonRunOptions([
      'run',
      '--machine',
      'mac-1',
      '--pairing-token',
      'hmrd_secret',
      '--endpoint',
      'https://hammurabi.example.com/',
    ])).toEqual({
      machineId: 'mac-1',
      pairingToken: 'hmrd_secret',
      endpoint: 'https://hammurabi.example.com',
    })
  })

  it('prints usage for invalid daemon commands', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()
    await expect(runDaemonCli(['run', '--machine', 'mac-1'], {
      stdout: stdout.writer,
      stderr: stderr.writer,
    })).resolves.toBe(1)
    expect(stdout.read()).toContain('hammurabi daemon run')
    expect(stderr.read()).toBe('')
  })

  it('reports provider auth from daemon-local env and explicit login probes', async () => {
    FakeDaemonWebSocket.instances = []
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()
    const controller = new AbortController()
    const daemonEnv = { HOME: '/daemon-home', PATH: '/daemon-bin' }
    let nextPid = 2000
    const spawnCalls: Array<{ command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = []
    const spawnImpl = ((command: string, args: readonly string[] = [], options?: SpawnOptions) => {
      spawnCalls.push({ command, args, env: options?.env })
      const child = new FakeChildProcess(nextPid++)
      queueMicrotask(() => {
        if (args[0] === '--version') {
          child.stdout.write(`${command} 1.0.0\n`)
          child.emit('close', 0, null)
          return
        }
        if (command === 'claude' && args.join(' ') === 'auth status') {
          child.stderr.write('not logged in\n')
          child.emit('close', 1, null)
          return
        }
        if (command === 'codex' && args.join(' ') === 'login status') {
          child.stdout.write('Logged in\n')
          child.emit('close', 0, null)
          return
        }
        child.emit('close', 0, null)
      })
      return child as unknown as ChildProcess
    }) as typeof import('node:child_process').spawn

    const daemonPromise = runDaemonCli([
      'run',
      '--machine',
      'mac-1',
      '--pairing-token',
      'hmrd_secret',
      '--endpoint',
      'http://hammurabi.local',
    ], {
      stdout: stdout.writer,
      stderr: stderr.writer,
      WebSocketImpl: FakeDaemonWebSocket,
      spawnImpl,
      reconnectDelayMs: 1,
      signal: controller.signal,
      env: daemonEnv,
    })

    await waitFor(() => FakeDaemonWebSocket.instances.length === 1, 'expected daemon websocket')
    const ws = FakeDaemonWebSocket.instances[0]
    expect(ws.url).toBe('ws://hammurabi.local/api/agents/daemons/ws?machine_id=mac-1')
    expect(ws.protocols).toEqual(['hammurabi-daemon', 'hmrd_secret'])
    ws.open()

    await waitFor(
      () => ws.sent.some((payload) => JSON.parse(payload).type === 'hello'),
      'expected hello provider health',
    )
    const hello = ws.sent
      .map((payload) => JSON.parse(payload) as {
        type?: string
        providerHealth?: Record<string, {
          authenticated: boolean
          authMethod: string | null
          detail: string | null
        }>
      })
      .find((payload) => payload.type === 'hello')!

    expect(hello.providerHealth?.claude).toMatchObject({
      authenticated: false,
      authMethod: null,
      detail: 'not logged in',
    })
    expect(hello.providerHealth?.codex).toMatchObject({
      authenticated: true,
      authMethod: 'login',
    })
    expect(hello.providerHealth?.gemini).toMatchObject({
      authenticated: false,
      authMethod: null,
    })
    expect(spawnCalls.every((call) => call.env?.HOME === '/daemon-home')).toBe(true)

    controller.abort()
    await expect(daemonPromise).resolves.toBe(0)
    expect(stderr.read()).toBe('')
  })

  it('keeps daemon children alive across websocket reconnects and replays buffered events', async () => {
    FakeDaemonWebSocket.instances = []
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()
    const controller = new AbortController()
    let nextPid = 1000
    const agentChildren: FakeChildProcess[] = []
    const spawnImpl = ((command: string, args?: readonly string[], _options?: SpawnOptions) => {
      const child = new FakeChildProcess(nextPid++)
      if (args?.[0] === '--version') {
        queueMicrotask(() => {
          child.stdout.write(`${command} 1.0.0\n`)
          child.emit('close', 0, null)
        })
        return child as unknown as ChildProcess
      }
      if (
        (command === 'claude' && args?.join(' ') === 'auth status') ||
        (command === 'codex' && args?.join(' ') === 'login status')
      ) {
        queueMicrotask(() => {
          child.emit('close', 1, null)
        })
        return child as unknown as ChildProcess
      }
      agentChildren.push(child)
      return child as unknown as ChildProcess
    }) as typeof import('node:child_process').spawn

    const daemonPromise = runDaemonCli([
      'run',
      '--machine',
      'mac-1',
      '--pairing-token',
      'hmrd_secret',
      '--endpoint',
      'http://hammurabi.local',
    ], {
      stdout: stdout.writer,
      stderr: stderr.writer,
      WebSocketImpl: FakeDaemonWebSocket,
      spawnImpl,
      reconnectDelayMs: 1,
      signal: controller.signal,
      env: { HOME: '/tmp' },
    })

    await waitFor(() => FakeDaemonWebSocket.instances.length === 1, 'expected initial daemon websocket')
    const first = FakeDaemonWebSocket.instances[0]
    first.open()
    first.message({ type: 'welcome', heartbeatIntervalMs: 50 })
    first.message({
      type: 'spawn',
      requestId: 'req-1',
      processId: 'proc-1',
      mode: 'pipe',
      command: 'claude',
      args: ['-p'],
    })

    await waitFor(() => agentChildren.length === 1, 'expected daemon child process')
    await waitFor(
      () => first.sent.some((payload) => JSON.parse(payload).type === 'spawned'),
      'expected spawned ack',
    )
    const child = agentChildren[0]

    first.close()
    expect(child.killed).toBe(false)
    child.stdout.write('assistant output while disconnected\n')

    await waitFor(() => FakeDaemonWebSocket.instances.length === 2, 'expected daemon reconnect')
    const second = FakeDaemonWebSocket.instances[1]
    second.open()
    second.message({ type: 'welcome', heartbeatIntervalMs: 50 })

    await waitFor(
      () => second.sent.some((payload) => {
        const message = JSON.parse(payload) as { type?: string; processId?: string; data?: string }
        return message.type === 'stdout' &&
          message.processId === 'proc-1' &&
          message.data === 'assistant output while disconnected\n'
      }),
      'expected buffered stdout replay after reconnect',
    )

    controller.abort()
    await expect(daemonPromise).resolves.toBe(0)
    expect(child.killed).toBe(true)
    expect(stderr.read()).toBe('')
  })
})
