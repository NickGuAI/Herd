import type { ProviderAdapter } from './provider-adapter.js'

const providerRegistry = new Map<string, ProviderAdapter>()
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/
export const DEFAULT_PROVIDER_ID = 'claude'
export const DEFAULT_AUTOMATION_PROVIDER_ID = 'codex'

export function registerProvider<T extends ProviderAdapter>(adapter: T): T {
  const id = adapter.id.trim()
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(`Invalid provider id "${adapter.id}"`)
  }

  const existing = providerRegistry.get(id)
  if (existing && existing !== adapter) {
    throw new Error(`Provider "${id}" is already registered`)
  }

  providerRegistry.set(id, adapter)
  return adapter
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return providerRegistry.get(id.trim())
}

export function unregisterProvider(id: string): void {
  providerRegistry.delete(id.trim())
}

export function listProviders(): ProviderAdapter[] {
  return [...providerRegistry.values()]
}

export function listProviderIds(): string[] {
  return [...providerRegistry.keys()]
}

export function parseProviderId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const id = raw.trim()
  return providerRegistry.has(id) ? id : null
}

export function resolveDefaultProviderId(preferredProviderId = DEFAULT_PROVIDER_ID): string {
  return providerRegistry.has(preferredProviderId)
    ? preferredProviderId
    : (listProviders()[0]?.id ?? preferredProviderId)
}

export function resolveAutomationDefaultProviderId(): string {
  return resolveDefaultProviderId(DEFAULT_AUTOMATION_PROVIDER_ID)
}

export interface ProviderIdResolution {
  providerId: string | null
  error: string | null
  validIds: string[]
}

export function resolveProviderIdForRequest(
  raw: unknown,
  options: {
    defaultProviderId?: string
    fieldName?: string
  } = {},
): ProviderIdResolution {
  const validIds = listProviderIds()
  if (raw === undefined || raw === null || raw === '') {
    return {
      providerId: resolveDefaultProviderId(options.defaultProviderId),
      error: null,
      validIds,
    }
  }

  const providerId = parseProviderId(raw)
  if (providerId) {
    return {
      providerId,
      error: null,
      validIds,
    }
  }

  const fieldName = options.fieldName ?? 'agentType'
  return {
    providerId: null,
    error: `Invalid ${fieldName}. Expected one of: ${validIds.join(', ')}`,
    validIds,
  }
}
