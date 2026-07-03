import type { CommanderChannelBinding } from './types.js'

export function bindingRoutesToCommander(binding: CommanderChannelBinding, commanderId: string): boolean {
  return binding.commanderId === commanderId
}

export function effectiveBindingCommanderId(
  binding: CommanderChannelBinding,
  requestedCommanderId?: string,
): string {
  if (requestedCommanderId && bindingRoutesToCommander(binding, requestedCommanderId)) {
    return requestedCommanderId
  }
  return binding.commanderId
}
