import { createEvalRouter } from './routes.js'
import { createEvalAdapterPreflight } from './adapter-preflight.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createEvalFoundation(context: ModuleRuntimeContext): null {
  const preflight = createEvalAdapterPreflight(
    context.capabilities.consume('agents.machine-command-executor', 'eval'),
  )
  context.capabilities.provide('eval.adapter-preflight', 'eval', preflight)
  return null
}

export function createEvalRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  return {
    name: 'eval',
    routeIds: ['eval.api'],
    router: createEvalRouter({
      apiKeyStore: context.options.apiKeyStore,
      auth0Domain: context.options.auth0Domain,
      auth0Audience: context.options.auth0Audience,
      auth0ClientId: context.options.auth0ClientId,
    }),
  }
}
