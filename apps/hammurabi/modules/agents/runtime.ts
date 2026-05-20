import { createAgentsRouter } from './routes.js'
import { listProviders } from './providers/registry.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createAgentsRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context

  capabilities.provide('agents.provider-registry', 'agents', { listProviders })

  const agents = createAgentsRouter({
    apiKeyStore: options.apiKeyStore,
    getActionPolicyGate: () => capabilities.consume('policies.action-gate', 'agents'),
    maxSessions: options.maxAgentSessions,
    internalToken,
    questStore: capabilities.consume('commanders.quest-store', 'agents'),
    getWorkspaceResolver: () => capabilities.consume('workspace.resolver', 'agents'),
  })

  capabilities.provide('agents.sessions', 'agents', agents.sessionsInterface)
  capabilities.provide('agents.sessions-interface', 'agents', agents.sessionsInterface)
  capabilities.provide('agents.approval-sessions-interface', 'agents', agents.approvalSessionsInterface)
  capabilities.provide('agents.session-websocket', 'agents', agents.handleUpgrade)
  capabilities.provide('agents.runtime', 'agents', agents)

  return {
    name: 'agents',
    routeIds: ['agents.api'],
    router: agents.router,
    handleUpgrade: agents.handleUpgrade,
    shutdown: agents.sessionsInterface.shutdown,
  }
}
