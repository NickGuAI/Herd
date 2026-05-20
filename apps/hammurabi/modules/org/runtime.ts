import { createOrgRouter } from './route.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createOrgRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context
  const commanderDataDir = capabilities.consume('commanders.data-dir', 'org')

  return {
    name: 'org',
    label: 'Org Chart',
    routeIds: ['org.api', 'org-identity.api'],
    router: createOrgRouter({
      sessionStore: capabilities.consume('commanders.store', 'org'),
      automationStore: capabilities.consume('automations.store', 'org'),
      conversationStore: capabilities.consume('commanders.conversations', 'org'),
      questStore: capabilities.consume('commanders.quest-store', 'org'),
      operatorStore: capabilities.consume('operators.store', 'org'),
      commanderDataDir,
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      internalToken,
    }),
  }
}
