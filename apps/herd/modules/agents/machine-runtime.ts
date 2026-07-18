import { MachineDaemonRegistry } from './daemon/registry.js'
import { createMachineCommandExecutor } from './machine-command-executor.js'
import { createMachineRegistryStore } from './machines.js'

export function createMachineRuntime(machinesFilePath: string) {
  const machineRegistry = createMachineRegistryStore(machinesFilePath)
  const daemonRegistry = new MachineDaemonRegistry()

  return {
    machineRegistry,
    daemonRegistry,
    machineCommandExecutor: createMachineCommandExecutor({ machineRegistry, daemonRegistry }),
  }
}
