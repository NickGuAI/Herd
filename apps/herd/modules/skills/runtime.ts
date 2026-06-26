import { createSkillsRouter } from './routes.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createSkillsRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { options } = context

  return {
    name: 'skills',
    routeIds: ['skills.api'],
    router: createSkillsRouter({
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
    }),
  }
}
