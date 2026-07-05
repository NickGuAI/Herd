import type { MachineConfig, MachineDaemonAction, MachineDaemonStatus } from './types.js'

export const MACHINE_DAEMON_PAIR_ACTION = {
  id: 'pair',
  label: 'Pair Daemon',
} as const satisfies MachineDaemonAction

export const MACHINE_DAEMON_ROTATE_ACTION = {
  id: 'rotate',
  label: 'Rotate Pairing',
} as const satisfies MachineDaemonAction

export const MACHINE_DAEMON_REVOKE_ACTION = {
  id: 'revoke',
  label: 'Revoke',
} as const satisfies MachineDaemonAction

export const MACHINE_DAEMON_PENDING_STATUS_LABELS = {
  connectionLabel: 'ssh/local',
  providerAuthLabel: 'not checked',
} as const

export function getMachineDisplayLabel(machine: Pick<MachineConfig, 'id' | 'label'>): string {
  return machine.label || machine.id
}

type MachineDaemonDisplayDto = Pick<
  MachineDaemonStatus,
  | 'displayLabel'
  | 'connectionState'
  | 'connectionLabel'
  | 'providerAuthState'
  | 'providerAuthLabel'
  | 'allowedActions'
>

function hasActiveDaemonPairing(machine: Pick<MachineConfig, 'daemon'>): boolean {
  return Boolean(
    !machine.daemon?.revokedAt &&
    !isExpiredIsoTimestamp(machine.daemon?.expiresAt) &&
    (machine.daemon?.pairedAt || machine.daemon?.pairingTokenHash),
  )
}

function isExpiredIsoTimestamp(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }
  const timestamp = Date.parse(value)
  return !Number.isFinite(timestamp) || timestamp <= Date.now()
}

export function buildMachineDaemonDisplayDto(
  machine: MachineConfig,
  status: Pick<MachineDaemonStatus, 'paired' | 'connected' | 'providerAuthReady'>,
): MachineDaemonDisplayDto {
  const selectedTransport = machine.transport ?? (machine.host ? 'ssh' : 'local')
  const connectionState = status.connected
    ? 'connected'
    : status.paired
      ? 'paired'
      : selectedTransport === 'daemon'
        ? 'not-paired'
        : selectedTransport === 'local'
          ? 'local'
          : 'ssh-local'
  const providerAuthState = status.providerAuthReady
    ? 'ready'
    : status.paired
      ? 'missing'
      : 'not-checked'

  return {
    displayLabel: getMachineDisplayLabel(machine),
    connectionState,
    connectionLabel: {
      connected: 'connected',
      paired: 'paired',
      'not-paired': 'not paired',
      local: 'local',
      'ssh-local': 'ssh/local',
    }[connectionState],
    providerAuthState,
    providerAuthLabel: {
      ready: 'providers ready',
      missing: 'providers missing',
      'not-checked': 'not checked',
    }[providerAuthState],
    allowedActions: machine.id === 'local'
      ? []
      : status.paired
        ? [MACHINE_DAEMON_ROTATE_ACTION, MACHINE_DAEMON_REVOKE_ACTION]
        : [MACHINE_DAEMON_PAIR_ACTION],
  }
}

export function buildMachineDaemonPendingDisplayDto(machine: MachineConfig): MachineDaemonDisplayDto {
  return buildMachineDaemonDisplayDto(machine, {
    paired: hasActiveDaemonPairing(machine),
    connected: false,
    providerAuthReady: false,
  })
}
