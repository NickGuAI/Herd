import type { ChannelAdapter, ChannelProvider } from './types.js'

const adapters = new Map<ChannelProvider, ChannelAdapter>()

export function replaceChannelAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.provider, adapter)
}

export function getChannelAdapter(provider: ChannelProvider): ChannelAdapter | null {
  return adapters.get(provider) ?? null
}

export function resetChannelAdaptersForTests(): void {
  adapters.clear()
}
