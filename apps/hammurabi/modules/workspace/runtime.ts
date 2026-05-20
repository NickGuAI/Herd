import path from 'node:path'
import { createMachineRegistryStore } from '../agents/machines.js'
import { resolveHammurabiDataDir } from '../data-dir.js'
import { createWorkspaceRouter } from './routes.js'
import { WorkspaceResolver } from './capability.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createWorkspaceRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, options } = context
  const machineDescriptor = createMachineRegistryStore(path.join(resolveHammurabiDataDir(), 'machines.json'))
  const resolver = new WorkspaceResolver({
    machineDescriptor,
    conversationStore: capabilities.consume('commanders.conversations', 'workspace'),
    commanderStore: capabilities.consume('commanders.store', 'workspace'),
    sessionsInterface: capabilities.consume('agents.sessions-interface', 'workspace'),
  })

  capabilities.provide('agents.machineDescriptor', 'agents', machineDescriptor)
  capabilities.provide('workspace.resolver', 'workspace', resolver)

  return {
    name: 'workspace',
    routeIds: ['workspace.api'],
    router: createWorkspaceRouter({
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      resolver,
    }),
  }
}
