import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  buildDaemonMachineHealthReport,
  buildMachineDaemonStatus,
  resolveMachineTransportStatus,
} from '../daemon/status'
import { buildMachineDaemonPairCommand } from '../daemon/pairing-command'
import {
  HAMMURABI_DAEMON_PROTOCOL_VERSION,
  parseDaemonClientMessage,
  parseDaemonServerMessage,
} from '../daemon/protocol'
import {
  hashDaemonPairingToken,
  MachineDaemonRegistry,
  verifyDaemonPairingToken,
  type DaemonConnectionSnapshot,
} from '../daemon/registry'
import type { MachineConfig } from '../types'

describe('daemon protocol', () => {
  it('parses hello and heartbeat messages with provider health', () => {
    const hello = parseDaemonClientMessage(JSON.stringify({
      type: 'hello',
      protocolVersion: HAMMURABI_DAEMON_PROTOCOL_VERSION,
      machineId: 'mac-1',
      daemonVersion: '0.1.0',
      pid: 42,
      platform: 'darwin',
      arch: 'arm64',
      providers: {
        claude: {
          installed: true,
          authenticated: true,
          version: '1.0.31',
          authMethod: 'login',
        },
      },
    }))

    expect(hello).toMatchObject({
      type: 'hello',
      machineId: 'mac-1',
      daemonVersion: '0.1.0',
      providerHealth: {
        claude: {
          installed: true,
          authenticated: true,
          version: '1.0.31',
          authMethod: 'login',
        },
      },
    })

    const heartbeat = parseDaemonClientMessage({
      type: 'heartbeat',
      sequence: 7,
      providerHealth: {
        codex: {
          installed: true,
          configured: true,
          version: '0.1.0',
          method: 'device-auth',
        },
      },
      activeProcesses: 2,
    })

    expect(heartbeat).toMatchObject({
      type: 'heartbeat',
      sequence: 7,
      activeProcesses: 2,
      providerHealth: {
        codex: {
          authenticated: true,
          authMethod: 'device-auth',
        },
      },
    })
  })

  it('rejects malformed protocol messages and verifies pairing tokens by hash', () => {
    expect(parseDaemonClientMessage('not json')).toBeNull()
    expect(parseDaemonClientMessage({
      type: 'hello',
      protocolVersion: 999,
      machineId: 'mac-1',
      daemonVersion: '0.1.0',
    })).toBeNull()
    expect(parseDaemonClientMessage({ type: 'heartbeat', sequence: -1 })).toBeNull()

    const hash = hashDaemonPairingToken('hmrd_secret')
    expect(verifyDaemonPairingToken('hmrd_secret', hash)).toBe(true)
    expect(verifyDaemonPairingToken('wrong', hash)).toBe(false)
  })

  it('parses daemon process transport messages in both directions', () => {
    expect(parseDaemonServerMessage({
      type: 'spawn',
      requestId: 'req-1',
      processId: 'proc-1',
      mode: 'pipe',
      command: 'claude',
      args: ['-p'],
      cwd: '/tmp/work',
      env: { FOO: 'bar', DROP: 1 },
    })).toEqual({
      type: 'spawn',
      requestId: 'req-1',
      processId: 'proc-1',
      mode: 'pipe',
      command: 'claude',
      args: ['-p'],
      cwd: '/tmp/work',
      env: { FOO: 'bar' },
    })

    expect(parseDaemonServerMessage({
      type: 'stdin',
      processId: 'proc-1',
      data: 'hello\n',
    })).toEqual({
      type: 'stdin',
      processId: 'proc-1',
      data: 'hello\n',
    })

    expect(parseDaemonClientMessage({
      type: 'spawned',
      requestId: 'req-1',
      processId: 'proc-1',
      pid: 123,
    })).toEqual({
      type: 'spawned',
      requestId: 'req-1',
      processId: 'proc-1',
      pid: 123,
    })

    expect(parseDaemonClientMessage({
      type: 'pty-data',
      processId: 'proc-1',
      data: 'terminal output',
    })).toEqual({
      type: 'pty-data',
      processId: 'proc-1',
      data: 'terminal output',
    })

    expect(parseDaemonClientMessage({
      type: 'exit',
      processId: 'proc-1',
      exitCode: 0,
      signal: null,
    })).toEqual({
      type: 'exit',
      processId: 'proc-1',
      exitCode: 0,
      signal: null,
    })
  })
})

describe('daemon machine status', () => {
  const daemonMachine: MachineConfig = {
    id: 'mac-1',
    label: 'Mac',
    host: null,
    transport: 'daemon',
    daemon: {
      pairingTokenHash: 'hash',
      pairedAt: '2026-05-19T00:00:00.000Z',
    },
  }

  const connection: DaemonConnectionSnapshot = {
    machineId: 'mac-1',
    connectionId: 'conn-1',
    connectedAt: '2026-05-19T00:01:00.000Z',
    lastSeenAt: '2026-05-19T00:01:05.000Z',
    daemonVersion: '0.1.0',
    protocolVersion: HAMMURABI_DAEMON_PROTOCOL_VERSION,
    pid: 42,
    platform: 'darwin',
    arch: 'arm64',
    activeProcesses: 1,
    providerHealth: {
      claude: {
        provider: 'claude',
        installed: true,
        authenticated: true,
        version: '1.0.31',
        authMethod: 'login',
        detail: null,
        checkedAt: '2026-05-19T00:01:05.000Z',
      },
    },
  }

  it('reports daemon connectivity, provider auth readiness, and launchability', () => {
    expect(resolveMachineTransportStatus(daemonMachine, null)).toEqual({
      type: 'daemon',
      connected: false,
      providerAuthReady: false,
      launchable: false,
      reason: 'daemon is not connected',
    })

    expect(buildMachineDaemonStatus(daemonMachine, connection)).toMatchObject({
      machineId: 'mac-1',
      displayLabel: 'Mac',
      paired: true,
      connected: true,
      connectionState: 'connected',
      connectionLabel: 'connected',
      selectedTransport: 'daemon',
      providerAuthReady: true,
      providerAuthState: 'ready',
      providerAuthLabel: 'providers ready',
      launchable: true,
      launchUnsupportedReason: null,
      allowedActions: [
        { id: 'rotate', label: 'Rotate Pairing' },
        { id: 'revoke', label: 'Revoke' },
      ],
      daemonVersion: '0.1.0',
      providerHealth: {
        claude: {
          authenticated: true,
        },
      },
    })
  })

  it('builds daemon health without pretending SSH is available', () => {
    const health = buildDaemonMachineHealthReport(daemonMachine, connection)
    expect(health.mode).toBe('daemon')
    expect(health.ssh.ok).toBe(false)
    expect(health.daemon?.connected).toBe(true)
    expect(health.daemon?.launchable).toBe(true)
    expect(health.tools.claude).toEqual({
      ok: true,
      version: '1.0.31',
      raw: '1.0.31',
    })
  })

  it('projects machine card labels and actions for current mobile states', () => {
    expect(buildMachineDaemonStatus({
      id: 'local',
      label: 'Local (this server)',
      host: null,
      transport: 'local',
    }, null)).toMatchObject({
      displayLabel: 'Local (this server)',
      connectionState: 'local',
      connectionLabel: 'local',
      providerAuthState: 'not-checked',
      providerAuthLabel: 'not checked',
      allowedActions: [],
    })

    expect(buildMachineDaemonStatus({
      id: 'ssh-1',
      label: 'SSH Mac',
      host: '100.64.1.1',
      transport: 'ssh',
    }, null)).toMatchObject({
      displayLabel: 'SSH Mac',
      connectionState: 'ssh-local',
      connectionLabel: 'ssh/local',
      providerAuthState: 'not-checked',
      providerAuthLabel: 'not checked',
      allowedActions: [{ id: 'pair', label: 'Pair Daemon' }],
    })

    expect(buildMachineDaemonStatus(daemonMachine, null)).toMatchObject({
      connectionState: 'paired',
      connectionLabel: 'paired',
      providerAuthState: 'missing',
      providerAuthLabel: 'providers missing',
      allowedActions: [
        { id: 'rotate', label: 'Rotate Pairing' },
        { id: 'revoke', label: 'Revoke' },
      ],
    })

    expect(buildMachineDaemonStatus(daemonMachine, {
      ...connection,
      providerHealth: {
        claude: {
          ...connection.providerHealth.claude!,
          authenticated: false,
        },
      },
    })).toMatchObject({
      connectionState: 'connected',
      connectionLabel: 'connected',
      providerAuthState: 'missing',
      providerAuthLabel: 'providers missing',
    })
  })

  it('builds display-safe and full daemon pairing commands on the backend', () => {
    expect(buildMachineDaemonPairCommand({
      machineId: 'mac-1',
      token: 'hmrd_secret',
      endpoint: 'https://hammurabi.example.com/',
    })).toEqual({
      shortCommand: 'hammurabi daemon run --machine mac-1 --pairing-token <pairing-token> --endpoint https://hammurabi.example.com',
      fullCommand: 'hammurabi daemon run --machine mac-1 --pairing-token hmrd_secret --endpoint https://hammurabi.example.com',
      disclosureLabel: 'Show full pairing command',
    })
  })
})

class FakeDaemonSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = this.OPEN
  sent: string[] = []
  closeEvents: Array<{ code?: number; reason?: string }> = []
  terminated = false

  send(payload: string): void {
    this.sent.push(payload)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.closeEvents.push({ code, reason })
  }

  terminate(): void {
    this.readyState = 3
    this.terminated = true
  }
}

describe('daemon registry connection lifecycle', () => {
  it('detaches server transport on shutdown without retiring live daemon processes', () => {
    const registry = new MachineDaemonRegistry()
    const socket = new FakeDaemonSocket()
    registry.attach('mac-1', socket as never)

    const child = registry.spawnProcess('mac-1', {
      command: 'claude',
      args: ['-p'],
      cwd: '/Users/nick/work',
    })
    let exited = false
    child.on('exit', () => {
      exited = true
    })

    registry.shutdown()

    expect(exited).toBe(false)
    expect(registry.getConnection('mac-1')).toBeNull()
    expect(socket.closeEvents.at(-1)?.reason).toBe('Hammurabi server shutting down')

    const reconnected = new FakeDaemonSocket()
    registry.attach('mac-1', reconnected as never)
    child.stdin.write('still alive\n')

    expect(reconnected.sent.some((payload) => {
      const message = JSON.parse(payload) as { type?: string; data?: string }
      return message.type === 'stdin' && message.data === 'still alive\n'
    })).toBe(true)
  })

  it('revoke disconnect explicitly kills and retires daemon processes', () => {
    const registry = new MachineDaemonRegistry()
    const socket = new FakeDaemonSocket()
    registry.attach('mac-1', socket as never)

    const child = registry.spawnProcess('mac-1', {
      command: 'claude',
      args: ['-p'],
    })
    let exitCode: number | null = null
    child.on('exit', (code) => {
      exitCode = code
    })

    registry.disconnect('mac-1', 'Daemon pairing revoked')

    expect(exitCode).toBe(1)
    expect(socket.sent.some((payload) => {
      const message = JSON.parse(payload) as { type?: string }
      return message.type === 'kill'
    })).toBe(true)
  })
})
