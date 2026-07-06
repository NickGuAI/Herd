import { getProvider } from '../providers/registry.js'
import {
  isDaemonMachine,
  LOCAL_MACHINE_ID,
} from '../machines.js'
import { isDaemonPairingTokenExpired, type MachineDaemonRegistry } from '../daemon/registry.js'
import type { AgentType, MachineConfig } from '../types.js'
import {
  resolveReadyHostManagedPoolCredential,
  type ProviderAuthStore,
} from '../provider-auth.js'

interface MachineLaunchRuntimeDeps {
  daemonRegistry: MachineDaemonRegistry
  providerAuthStore: Pick<ProviderAuthStore, 'listPoolCredentials'>
  readMachineRegistry(): Promise<MachineConfig[]>
}

type DaemonLaunchReadiness =
  | { ok: true }
  | { ok: false; status: number; error: string }

export interface MachineLaunchRuntime {
  resolveLaunchMachine(
    requestedHost: string | undefined,
  ): Promise<
    | { ok: true; machine: MachineConfig | undefined }
    | { ok: false; status: number; error: string }
  >
  resolveDaemonLaunchReadiness(
    machine: MachineConfig | undefined,
    agentType: AgentType,
  ): Promise<DaemonLaunchReadiness>
}

export function createMachineLaunchRuntime(
  deps: MachineLaunchRuntimeDeps,
): MachineLaunchRuntime {
  async function resolveLaunchMachine(
    requestedHost: string | undefined,
  ): Promise<
    | { ok: true; machine: MachineConfig | undefined }
    | { ok: false; status: number; error: string }
  > {
    const machineId = requestedHost ?? LOCAL_MACHINE_ID
    let machines: MachineConfig[]
    try {
      machines = await deps.readMachineRegistry()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read machines registry'
      return { ok: false, status: 500, error: message }
    }

    const machine = machines.find((entry) => entry.id === machineId)
    if (!machine && requestedHost !== undefined) {
      return { ok: false, status: 400, error: `Unknown host machine "${requestedHost}"` }
    }
    return { ok: true, machine }
  }

  async function resolveDaemonLaunchReadiness(
    machine: MachineConfig | undefined,
    agentType: AgentType,
  ): Promise<DaemonLaunchReadiness> {
    if (!isDaemonMachine(machine)) {
      return { ok: true }
    }
    // A daemon whose pairing token expired must not accept new sessions, even
    // while its WebSocket from before the expiry is still connected. This
    // keeps the launch gate in agreement with resolveMachineTransportStatus.
    if (isDaemonPairingTokenExpired(machine.daemon?.expiresAt)) {
      return {
        ok: false,
        status: 409,
        error: `Daemon machine "${machine.id}" pairing token expired; rotate pairing or mint a new enrollment token`,
      }
    }
    const connection = deps.daemonRegistry.getConnection(machine.id)
    if (!connection) {
      return {
        ok: false,
        status: 409,
        error: `Daemon machine "${machine.id}" is not connected`,
      }
    }
    const provider = getProvider(agentType)
    const providerKeys = [
      agentType,
      provider?.machineAuth?.cliBinaryName,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    const installed = providerKeys.some((key) => {
      const status = connection.providerHealth[key]
      return status?.installed === true
    })
    const nativeReady = providerKeys.some((key) => {
      const status = connection.providerHealth[key]
      return status?.installed === true && status.authenticated === true
    })
    if (installed && nativeReady) {
      return { ok: true }
    }

    let hostManagedReady = false
    if (installed) {
      try {
        hostManagedReady = (await resolveReadyHostManagedPoolCredential({
          provider: agentType,
          host: machine.id,
          store: deps.providerAuthStore,
        })).ready
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read provider credential pool'
        return {
          ok: false,
          status: 500,
          error: message,
        }
      }
    }
    if (!installed || !hostManagedReady) {
      return {
        ok: false,
        status: 409,
        error: `Daemon machine "${machine.id}" is not ready for ${agentType}: provider auth is missing`,
      }
    }
    return { ok: true }
  }

  return {
    resolveLaunchMachine,
    resolveDaemonLaunchReadiness,
  }
}
