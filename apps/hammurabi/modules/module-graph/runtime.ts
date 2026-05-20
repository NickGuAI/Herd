import { createModuleGraphRouter } from './routes.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createModuleGraphRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { internalToken, moduleGraph, options } = context

  return {
    name: 'module-graph',
    routeIds: ['module-graph.api'],
    router: createModuleGraphRouter({
      moduleGraph,
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      internalToken,
    }),
  }
}
