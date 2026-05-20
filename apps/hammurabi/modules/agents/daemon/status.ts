import { listMachineProviders } from '../providers/machine-provider-adapter.js'
import type {
  MachineConfig,
  MachineDaemonStatus,
  MachineHealthReport,
  MachineToolKey,
  MachineToolStatus,
  MachineTransportStatus,
} from '../types.js'
import { createMissingToolStatus } from '../machines.js'
import { buildMachineDaemonDisplayDto } from '../machine-daemon-dtos.js'
import type { DaemonConnectionSnapshot } from './registry.js'

export const DAEMON_TRANSPORT_UNSUPPORTED_REASON =
  'daemon transport is not connected or provider auth is not ready'

function listMachineToolKeys(): MachineToolKey[] {
  return [
    ...new Set([
      ...listMachineProviders().map((provider) => provider.cliBinaryName),
      'git',
      'node',
    ]),
  ]
}

function providerReady(status: DaemonConnectionSnapshot | null): boolean {
  const values = Object.values(status?.providerHealth ?? {})
  return values.length > 0 && values.some((entry) => entry.installed && entry.authenticated)
}

export function resolveMachineTransportStatus(
  machine: MachineConfig,
  daemonConnection: DaemonConnectionSnapshot | null,
): MachineTransportStatus {
  const transport = machine.transport ?? (machine.host ? 'ssh' : 'local')
  if (transport === 'daemon') {
    const connected = Boolean(daemonConnection)
    const authReady = providerReady(daemonConnection)
    return {
      type: 'daemon',
      connected,
      providerAuthReady: authReady,
      launchable: connected && authReady,
      reason: !connected
        ? 'daemon is not connected'
        : (authReady ? null : 'daemon provider auth is not ready'),
    }
  }
  if (transport === 'ssh') {
    return {
      type: 'ssh',
      connected: Boolean(machine.host),
      providerAuthReady: false,
      launchable: Boolean(machine.host),
      reason: machine.host ? null : 'ssh transport requires a host',
    }
  }
  return {
    type: 'local',
    connected: true,
    providerAuthReady: false,
    launchable: true,
    reason: null,
  }
}

export function buildMachineDaemonStatus(
  machine: MachineConfig,
  daemonConnection: DaemonConnectionSnapshot | null,
): MachineDaemonStatus {
  const daemonConfig = machine.daemon
  const paired = Boolean(daemonConfig?.pairingTokenHash && !daemonConfig.revokedAt)
  const transport = resolveMachineTransportStatus(machine, daemonConnection)

  return {
    machineId: machine.id,
    ...buildMachineDaemonDisplayDto(machine, {
      paired,
      connected: Boolean(daemonConnection),
      providerAuthReady: transport.providerAuthReady,
    }),
    paired,
    connected: Boolean(daemonConnection),
    selectedTransport: transport.type,
    providerAuthReady: transport.providerAuthReady,
    launchable: transport.launchable,
    launchUnsupportedReason: transport.launchable ? null : transport.reason,
    pairedAt: daemonConfig?.pairedAt ?? null,
    revokedAt: daemonConfig?.revokedAt ?? null,
    connectedAt: daemonConnection?.connectedAt ?? null,
    lastSeenAt: daemonConnection?.lastSeenAt ?? daemonConfig?.lastSeenAt ?? null,
    connectionId: daemonConnection?.connectionId ?? null,
    daemonVersion: daemonConnection?.daemonVersion ?? daemonConfig?.daemonVersion ?? null,
    protocolVersion: daemonConnection?.protocolVersion ?? null,
    pid: daemonConnection?.pid ?? null,
    platform: daemonConnection?.platform ?? null,
    arch: daemonConnection?.arch ?? null,
    activeProcesses: daemonConnection?.activeProcesses ?? null,
    providerHealth: daemonConnection?.providerHealth ?? {},
  }
}

function buildDaemonToolStatus(
  tool: MachineToolKey,
  daemonConnection: DaemonConnectionSnapshot | null,
): MachineToolStatus {
  const provider = Object.values(daemonConnection?.providerHealth ?? {})
    .find((entry) => entry.provider === tool)
  if (!provider || !provider.installed) {
    return createMissingToolStatus()
  }

  const raw = provider.version ?? 'installed'
  return {
    ok: true,
    version: provider.version,
    raw,
  }
}

export function buildDaemonMachineHealthReport(
  machine: MachineConfig,
  daemonConnection: DaemonConnectionSnapshot | null,
): MachineHealthReport {
  const tools = Object.fromEntries(
    listMachineToolKeys().map((tool) => [tool, buildDaemonToolStatus(tool, daemonConnection)]),
  ) as Record<MachineToolKey, MachineToolStatus>

  return {
    machineId: machine.id,
    mode: 'daemon',
    ssh: {
      ok: false,
    },
    daemon: buildMachineDaemonStatus(machine, daemonConnection),
    tools,
  }
}
