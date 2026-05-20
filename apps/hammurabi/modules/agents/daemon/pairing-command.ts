import type { MachineDaemonPairCommand } from '../types.js'

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/u, '')
}

export function buildMachineDaemonPairCommand(options: {
  machineId: string
  token: string
  endpoint: string
}): MachineDaemonPairCommand {
  const endpoint = normalizeEndpoint(options.endpoint)
  return {
    shortCommand: `hammurabi daemon run --machine ${options.machineId} --pairing-token <pairing-token> --endpoint ${endpoint}`,
    fullCommand: `hammurabi daemon run --machine ${options.machineId} --pairing-token ${options.token} --endpoint ${endpoint}`,
    disclosureLabel: 'Show full pairing command',
  }
}
