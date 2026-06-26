import { createSettingsRouter } from './routes.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createSettingsRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context

  capabilities.provide('settings.app-settings', 'settings', options.appSettingsStore)

  return {
    name: 'settings',
    routeIds: ['settings.api'],
    router: createSettingsRouter({
      store: options.appSettingsStore,
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      internalToken,
    }),
  }
}
