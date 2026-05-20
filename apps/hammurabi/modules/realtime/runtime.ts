import { createRealtimeProxy } from '../../server/realtime/proxy.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createRealtimeRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const realtime = createRealtimeProxy({
    apiKeyStore: context.options.apiKeyStore,
    transcriptionKeyStore: context.options.transcriptionKeyStore,
  })

  return {
    name: 'realtime',
    label: 'Realtime',
    routeIds: ['realtime.api'],
    router: realtime.router,
    handleUpgrade: realtime.handleUpgrade,
  }
}
