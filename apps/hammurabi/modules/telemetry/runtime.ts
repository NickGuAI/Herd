import { createOtelRouter } from './otel-receiver.js'
import { createTelemetryRouterWithHub } from './routes.js'
import type { Router } from 'express'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export interface TelemetryRuntimeResult {
  registration: ModuleRouteRegistration
  otelRouter: Router
}

export function createTelemetryRuntime(context: ModuleRuntimeContext): TelemetryRuntimeResult {
  const telemetry = createTelemetryRouterWithHub({
    apiKeyStore: context.options.apiKeyStore,
  })
  context.capabilities.provide('telemetry.hub', 'telemetry', telemetry.hub)
  context.capabilities.provide('telemetry.store', 'telemetry', telemetry.store)

  return {
    registration: {
      name: 'telemetry',
      routeIds: ['telemetry.api'],
      router: telemetry.router,
      shutdown: telemetry.shutdown,
    },
    otelRouter: createOtelRouter({
      hub: telemetry.hub,
      apiKeyStore: context.options.apiKeyStore,
    }),
  }
}
