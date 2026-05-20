import { createOperatorsRouter } from './routes.js'
import { OperatorStore } from './store.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createOperatorsRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context
  const operatorStore = new OperatorStore()
  capabilities.provide('operators.store', 'operators', operatorStore)

  return {
    name: 'operators',
    routeIds: ['operators.api'],
    router: createOperatorsRouter({
      store: operatorStore,
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      internalToken,
    }),
  }
}
