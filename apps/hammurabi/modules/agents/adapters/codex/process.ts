import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import {
  ANTHROPIC_MODEL_ENV_KEYS,
  buildCodexAppServerInvocation,
  buildLoginShellCommand,
  prepareDaemonMachineLaunchEnvironment,
  prepareMachineLaunchEnvironment,
  buildSshArgs,
  scrubEnvironmentVariables,
} from '../../machines.js'
import type { MachineDaemonRegistry } from '../../daemon/registry.js'
import type { MachineConfig } from '../../types.js'

export async function reserveLocalCodexRuntimePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
    const serverEmitter = srv as unknown as NodeJS.EventEmitter
    serverEmitter.on('error', reject)
  })
}

export async function spawnLocalCodexRuntime(
  spawnImpl: typeof spawn = spawn,
): Promise<{ port: number; process: ChildProcess }> {
  const port = await reserveLocalCodexRuntimePort()
  const process = spawnImpl('codex', ['app-server', '--listen', `ws://127.0.0.1:${port}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: scrubEnvironmentVariables(globalThis.process.env, ANTHROPIC_MODEL_ENV_KEYS),
  })
  return { port, process }
}

export function spawnRemoteCodexRuntime(
  machine: MachineConfig & { host: string },
  spawnImpl: typeof spawn = spawn,
): ChildProcess {
  const preparedLaunch = prepareMachineLaunchEnvironment(
    machine,
    scrubEnvironmentVariables(globalThis.process.env, ANTHROPIC_MODEL_ENV_KEYS),
  )
  const remoteCommand = buildLoginShellCommand(
    buildCodexAppServerInvocation(),
    undefined,
    preparedLaunch.sourcedEnvFile,
  )
  return spawnImpl('ssh', buildSshArgs(machine, remoteCommand, false, undefined, preparedLaunch.sshSendEnvKeys), {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: preparedLaunch.env,
  })
}

export function spawnDaemonCodexRuntime(
  machine: MachineConfig & { transport: 'daemon' },
  daemonRegistry: Pick<MachineDaemonRegistry, 'spawnProcess'>,
): ChildProcess {
  const preparedLaunch = prepareDaemonMachineLaunchEnvironment(machine)
  return daemonRegistry.spawnProcess(machine.id, {
    command: 'sh',
    args: ['-lc', buildLoginShellCommand(
      buildCodexAppServerInvocation(),
      undefined,
      preparedLaunch.sourcedEnvFile,
    )],
    env: preparedLaunch.env,
  })
}
