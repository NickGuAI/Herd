import type { ChannelAdapter, ChannelProvider } from './types.js'

export class ChannelAdapterAlreadyRegisteredError extends Error {
  readonly provider: ChannelProvider

  constructor(provider: ChannelProvider) {
    super(`Channel adapter already registered for provider "${provider}"`)
    this.name = 'ChannelAdapterAlreadyRegisteredError'
    this.provider = provider
  }
}

const adapters = new Map<ChannelProvider, ChannelAdapter>()

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  if (adapters.has(adapter.provider)) {
    throw new ChannelAdapterAlreadyRegisteredError(adapter.provider)
  }
  adapters.set(adapter.provider, adapter)
}

export function getChannelAdapter(provider: ChannelProvider): ChannelAdapter | null {
  return adapters.get(provider) ?? null
}

export function listChannelAdapters(): ChannelAdapter[] {
  return [...adapters.values()]
}

export function resetChannelAdaptersForTests(): void {
  adapters.clear()
}
