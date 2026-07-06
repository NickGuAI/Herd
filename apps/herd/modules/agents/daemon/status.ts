import { listMachineProviders } from '../providers/machine-provider-adapter.js'
import type {
  MachineConfig,
  MachineDaemonStatus,
  MachineDaemonProviderAuthMode,
  MachineDaemonProviderHealth,
  MachineHealthReport,
  MachineToolKey,
  MachineToolStatus,
  MachineTransportStatus,
} from '../types.js'
import { createMissingToolStatus } from '../machines.js'
import { buildMachineDaemonDisplayDto } from '../machine-daemon-dtos.js'
import { isDaemonPairingTokenExpired, type DaemonConnectionSnapshot } from './registry.js'

export const DAEMON_TRANSPORT_UNSUPPORTED_REASON =
  'daemon transport is not connected or provider auth is not ready'

export interface DaemonHostManagedAuthStatus {
  providerReady?: Record<string, boolean>
}

function listMachineToolKeys(): MachineToolKey[] {
  return [
    ...new Set([
      ...listMachineProviders().map((provider) => provider.cliBinaryName),
      'git',
      'node',
    ]),
  ]
}

function hostManagedAuthReady(
  key: string,
  entry: { provider: string },
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): boolean {
  return Boolean(
    hostManagedAuth?.providerReady?.[key] ||
    hostManagedAuth?.providerReady?.[entry.provider],
  )
}

function deriveProviderAuthMode(
  key: string,
  entry: MachineDaemonProviderHealth,
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): 'native' | 'host-managed' | 'missing' {
  if (!entry.installed) {
    return 'missing'
  }
  if (entry.authenticated) {
    return 'native'
  }
  return hostManagedAuthReady(key, entry, hostManagedAuth) ? 'host-managed' : 'missing'
}

function enrichProviderHealth(
  providerHealth: Record<string, MachineDaemonProviderHealth>,
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): Record<string, MachineDaemonProviderHealth> {
  return Object.fromEntries(
    Object.entries(providerHealth).map(([key, entry]) => {
      const authMode = deriveProviderAuthMode(key, entry, hostManagedAuth)
      return [
        key,
        {
          ...entry,
          authMode,
          nativeAuthenticated: entry.installed && entry.authenticated,
          hostManagedAuthenticated: entry.installed && authMode === 'host-managed',
        },
      ]
    }),
  )
}

function providerReady(
  status: DaemonConnectionSnapshot | null,
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): boolean {
  const entries = Object.entries(status?.providerHealth ?? {})
  return entries.length > 0 && entries.some(([key, entry]) => (
    entry.installed && (entry.authenticated || hostManagedAuthReady(key, entry, hostManagedAuth))
  ))
}

function providerAuthMode(
  status: DaemonConnectionSnapshot | null,
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): MachineDaemonProviderAuthMode {
  const entries = Object.entries(status?.providerHealth ?? {})
  if (entries.length === 0) {
    return 'not-checked'
  }
  let hasNative = false
  let hasHostManaged = false
  for (const [key, entry] of entries) {
    const mode = deriveProviderAuthMode(key, entry, hostManagedAuth)
    hasNative ||= mode === 'native'
    hasHostManaged ||= mode === 'host-managed'
  }
  if (hasNative && hasHostManaged) {
    return 'mixed'
  }
  if (hasNative) {
    return 'native'
  }
  if (hasHostManaged) {
    return 'host-managed'
  }
  return 'missing'
}

export function resolveMachineTransportStatus(
  machine: MachineConfig,
  daemonConnection: DaemonConnectionSnapshot | null,
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): MachineTransportStatus {
  const transport = machine.transport ?? (machine.host ? 'ssh' : 'local')
  if (transport === 'daemon') {
    const connected = Boolean(daemonConnection)
    const authReady = providerReady(daemonConnection, hostManagedAuth)
    const pairingExpired = isDaemonPairingTokenExpired(machine.daemon?.expiresAt)
    // An expired pairing blocks launches even while the daemon WebSocket is
    // still connected; status must agree with resolveDaemonLaunchReadiness.
    return {
      type: 'daemon',
      connected,
      providerAuthReady: authReady,
      launchable: connected && authReady && !pairingExpired,
      reason: pairingExpired
        ? 'daemon pairing token expired; rotate pairing or mint a new enrollment token'
        : !connected
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
  hostManagedAuth?: DaemonHostManagedAuthStatus,
): MachineDaemonStatus {
  const daemonConfig = machine.daemon
  const pairingExpired = isDaemonPairingTokenExpired(daemonConfig?.expiresAt)
  const paired = Boolean(daemonConfig?.pairingTokenHash && !daemonConfig.revokedAt && !pairingExpired)
  const transport = resolveMachineTransportStatus(machine, daemonConnection, hostManagedAuth)
  const authMode = providerAuthMode(daemonConnection, hostManagedAuth)

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
    providerAuthMode: authMode,
    launchable: transport.launchable,
    launchUnsupportedReason: transport.launchable ? null : transport.reason,
    pairedAt: daemonConfig?.pairedAt ?? null,
    expiresAt: daemonConfig?.expiresAt ?? null,
    pairingExpired,
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
    providerHealth: enrichProviderHealth(daemonConnection?.providerHealth ?? {}, hostManagedAuth),
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
  hostManagedAuth?: DaemonHostManagedAuthStatus,
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
    daemon: buildMachineDaemonStatus(machine, daemonConnection, hostManagedAuth),
    tools,
  }
}
