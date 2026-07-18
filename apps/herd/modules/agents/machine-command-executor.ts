import type { ChildProcess } from 'node:child_process'
import {
  buildRemoteCommand,
  buildSshArgs,
  countMachineEnvSendKeys,
  defaultLocalMachineConfig,
  ensureSshControlDir,
  isDaemonMachine,
  isRemoteMachine,
  prepareMachineLaunchEnvironment,
  runCapturedCommand,
  type MachineRegistryStore,
} from './machines.js'
import {
  isDaemonPairingTokenExpired,
  type MachineDaemonRegistry,
} from './daemon/registry.js'
import type { CapturedCommandResult } from './types.js'

export interface MachineCommandInput {
  machineId: string
  command: string
  args: string[]
  timeoutMs?: number
}

export type MachineCommandExecutionResult =
  | { ok: true; result: CapturedCommandResult }
  | { ok: false; status: number; error: string }

export interface MachineCommandExecutor {
  execute(input: MachineCommandInput): Promise<MachineCommandExecutionResult>
}

interface MachineCommandExecutorOptions {
  machineRegistry: Pick<MachineRegistryStore, 'readMachineRegistry'>
  daemonRegistry: Pick<MachineDaemonRegistry, 'getConnection' | 'spawnProcess'>
  env?: NodeJS.ProcessEnv
  runCapturedCommand?: typeof runCapturedCommand
}

const DEFAULT_MACHINE_COMMAND_TIMEOUT_MS = 10_000

export function createMachineCommandExecutor(
  options: MachineCommandExecutorOptions,
): MachineCommandExecutor {
  const env = options.env ?? process.env
  const capture = options.runCapturedCommand ?? runCapturedCommand

  return {
    async execute(input) {
      try {
        const machines = await options.machineRegistry.readMachineRegistry()
        const machine = machines.find((candidate) => candidate.id === input.machineId)
          ?? (input.machineId === 'local' ? defaultLocalMachineConfig() : undefined)

        if (!machine) {
          return {
            ok: false,
            status: 400,
            error: `Unknown host machine "${input.machineId}"`,
          }
        }

        const timeoutMs = input.timeoutMs ?? DEFAULT_MACHINE_COMMAND_TIMEOUT_MS

        if (isDaemonMachine(machine)) {
          if (isDaemonPairingTokenExpired(machine.daemon?.expiresAt)) {
            return {
              ok: false,
              status: 409,
              error: `Daemon machine "${machine.id}" pairing token expired`,
            }
          }
          if (!options.daemonRegistry.getConnection(machine.id)) {
            return {
              ok: false,
              status: 409,
              error: `Daemon machine "${machine.id}" is not connected`,
            }
          }

          const spawnImpl = ((
            command: string,
            args: string[],
          ): ChildProcess => options.daemonRegistry.spawnProcess(machine.id, {
            command,
            args,
          })) as unknown as typeof import('node:child_process').spawn

          const result = await capture(input.command, input.args, {
            timeoutMs,
            spawnImpl,
          })
          return { ok: true, result }
        }

        if (isRemoteMachine(machine)) {
          await ensureSshControlDir()
          const preparedLaunch = prepareMachineLaunchEnvironment(machine, env)
          const remoteCommand = buildRemoteCommand(
            input.command,
            input.args,
            undefined,
            preparedLaunch.sourcedEnvFile,
            countMachineEnvSendKeys(preparedLaunch.sshSendEnvKeys),
          )
          const result = await capture(
            'ssh',
            buildSshArgs(machine, remoteCommand, false, undefined, preparedLaunch.sshSendEnvKeys),
            {
              env: preparedLaunch.env,
              timeoutMs,
            },
          )
          return { ok: true, result }
        }

        const result = await capture(input.command, input.args, {
          env,
          timeoutMs,
        })
        return { ok: true, result }
      } catch (error) {
        return {
          ok: false,
          status: 502,
          error: error instanceof Error ? error.message : 'Machine command failed to start',
        }
      }
    },
  }
}
