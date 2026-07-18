import {
  prepareProviderSpawnAuth,
  ProviderAuthStore,
} from '../provider-auth.js'
import type {
  ProviderAdapter,
  ProviderModelDiscoveryContext,
} from './provider-adapter.js'

const providerModelDiscoveryAuthStore = new ProviderAuthStore()

export async function resolveProviderModelDiscoveryContext(
  provider: ProviderAdapter,
  credentialPoolId?: string,
): Promise<ProviderModelDiscoveryContext> {
  const providerAuth = await prepareProviderSpawnAuth({
    provider: provider.id,
    scopeId: 'provider-model-discovery',
    store: providerModelDiscoveryAuthStore,
    env: process.env,
    credentialPoolId,
    mode: 'probe',
  })
  return {
    providerAuth,
    ...(providerAuth.credentialPoolId
      ? { credentialPoolId: providerAuth.credentialPoolId }
      : credentialPoolId
        ? { credentialPoolId }
        : {}),
    ...(providerAuth.snapshot.accountId
      ? { accountId: providerAuth.snapshot.accountId }
      : providerAuth.snapshot.accountEmail
        ? { accountId: providerAuth.snapshot.accountEmail }
        : {}),
  }
}
