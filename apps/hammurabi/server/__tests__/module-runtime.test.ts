import { Router } from 'express'
import { describe, expect, it } from 'vitest'

import { HammurabiModuleLoaderError, type LoadedHammurabiModuleGraph } from '../module-loader'
import { createManifestMountedModules, deriveRuntimeRoutePrefix } from '../module-runtime'
import type { HammurabiRouteDeclaration } from '../../src/types/module-manifest'

function route(id: string, mount: string): HammurabiRouteDeclaration {
  return {
    id,
    surface: 'api',
    mount,
    methods: ['GET'],
    auth: 'api-key-or-auth0',
    ownerModuleId: id.split('.')[0],
  }
}

function graphForRoutes(routes: HammurabiRouteDeclaration[]): LoadedHammurabiModuleGraph {
  const manifestById = new Map(
    routes.map((declaredRoute) => [
      declaredRoute.ownerModuleId,
      {
        graph: {
          label: declaredRoute.ownerModuleId,
          status: 'active',
        },
      },
    ]),
  )

  return {
    manifestById,
    mountPlan: { routes },
  } as unknown as LoadedHammurabiModuleGraph
}

describe('deriveRuntimeRoutePrefix', () => {
  it('uses the common static prefix for multi-route routers', () => {
    expect(deriveRuntimeRoutePrefix([
      route('policies.api', '/api/action-policies'),
      route('approval-check.api', '/api/approval'),
    ])).toBe('/api')

    expect(deriveRuntimeRoutePrefix([
      route('commanders.api', '/api/commanders'),
      route('commanders.quests-api', '/api/commanders/:id/quests'),
    ])).toBe('/api/commanders')
  })

  it('stops static mounts before dynamic path segments', () => {
    expect(deriveRuntimeRoutePrefix([
      route('channels.api', '/api/commanders/:id/channels'),
    ])).toBe('/api/commanders')
  })

  it('can mount parent-owned aggregate routers from their declared manifest route', () => {
    expect(deriveRuntimeRoutePrefix([
      route('agents.providers-api', '/api/providers'),
    ], 'static-parent')).toBe('/api')
  })
})

describe('createManifestMountedModules', () => {
  it('rejects implicit aggregates that collapse below the primary route mount', () => {
    const routes = [
      route('agents.api', '/api/agents'),
      route('agents.providers-api', '/api/providers'),
    ]

    expect(() => createManifestMountedModules(graphForRoutes(routes), [
      {
        name: 'agents',
        routeIds: ['agents.api', 'agents.providers-api'],
        router: Router(),
      },
    ])).toThrow(HammurabiModuleLoaderError)

    expect(() => createManifestMountedModules(graphForRoutes(routes), [
      {
        name: 'agents',
        routeIds: ['agents.api', 'agents.providers-api'],
        router: Router(),
      },
    ])).toThrow(/agents\.api, agents\.providers-api.*\/api\/agents.*\/api/u)
  })

  it('allows explicit aggregate routers to mount at their common static prefix', () => {
    const routes = [
      route('policies.api', '/api/action-policies'),
      route('approval-check.api', '/api/approval'),
    ]

    const [module] = createManifestMountedModules(graphForRoutes(routes), [
      {
        name: 'policies',
        routeIds: ['policies.api', 'approval-check.api'],
        mountStrategy: 'common-static-prefix',
        router: Router(),
      },
    ])

    expect(module.routePrefix).toBe('/api')
  })
})
