import { createProviderRegistryRouter } from './http-router.js'
import { resolveProviderModelDiscoveryContext } from './model-discovery-context.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../../server/module-runtime.js'

export function createProviderRegistryRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { internalToken, options } = context
  return {
    name: 'providers',
    label: 'Provider Registry',
    routeIds: ['agents.providers-api'],
    mountStrategy: 'static-parent',
    router: createProviderRegistryRouter({
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      internalToken,
      async resolveModelDiscoveryContext(provider, credentialPoolId) {
        return await resolveProviderModelDiscoveryContext(provider, credentialPoolId)
      },
    }),
  }
}
