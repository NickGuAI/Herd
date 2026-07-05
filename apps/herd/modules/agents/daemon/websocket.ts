import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { MachineRegistryStore } from '../machines.js'
import type { MachineConfig } from '../types.js'
import { verifyDaemonPairingToken, type MachineDaemonRegistry } from './registry.js'

export interface DaemonWebSocketContext {
  machineRegistry: MachineRegistryStore
  daemonRegistry: MachineDaemonRegistry
  ready?: Promise<unknown>
}

function extractDaemonUpgradeRequest(req: IncomingMessage): {
  machineId: string
  pairingToken: string
} | null {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname !== '/api/agents/daemons/ws') {
    return null
  }

  const machineId = url.searchParams.get('machine_id')?.trim()
    ?? url.searchParams.get('machineId')?.trim()
    ?? ''
  const pairingToken = (req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith('hmrd_')) ?? ''
  if (!machineId || !pairingToken) {
    return null
  }

  return { machineId, pairingToken }
}

function findPairableMachine(
  machines: readonly MachineConfig[],
  machineId: string,
  pairingToken: string,
): MachineConfig | null {
  const machine = machines.find((entry) => entry.id === machineId)
  if (!machine?.daemon || machine.daemon.revokedAt) {
    return null
  }
  return verifyDaemonPairingToken(pairingToken, machine.daemon.pairingTokenHash, machine.daemon.expiresAt)
    ? machine
    : null
}

export function createDaemonWebSocket(ctx: DaemonWebSocketContext): {
  isDaemonUpgrade(req: IncomingMessage): boolean
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
} {
  const wss = new WebSocketServer({ noServer: true })

  function isDaemonUpgrade(req: IncomingMessage): boolean {
    try {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
      return url.pathname === '/api/agents/daemons/ws'
    } catch {
      return false
    }
  }

  function reject(socket: Duplex, status: number): void {
    const reason = status === 401 ? 'Unauthorized' : 'Bad Request'
    socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`)
    socket.destroy()
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const upgrade = extractDaemonUpgradeRequest(req)
    if (!upgrade) {
      reject(socket, 400)
      return
    }

    void Promise.resolve(ctx.ready).then(() => ctx.machineRegistry.readMachineRegistry()).then((machines) => {
      const machine = findPairableMachine(machines, upgrade.machineId, upgrade.pairingToken)
      if (!machine) {
        reject(socket, 401)
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        ctx.daemonRegistry.attach(machine.id, ws)
      })
    }).catch(() => {
      reject(socket, 401)
    })
  }

  return { isDaemonUpgrade, handleUpgrade }
}
