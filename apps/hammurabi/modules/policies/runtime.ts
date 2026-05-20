import { ActionPolicyGate } from './action-policy-gate.js'
import { ApprovalCoordinator } from './pending-store.js'
import { createApprovalsRouter } from './approvals-routes.js'
import { createPoliciesRouter } from './routes.js'
import { PolicyStore } from './store.js'
import { readCommanderDisplayNames } from '../commanders/names-lock.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createPoliciesFoundation(context: ModuleRuntimeContext): null {
  const { capabilities } = context
  const policyStore = new PolicyStore()
  const approvalCoordinator = new ApprovalCoordinator()
  const actionPolicyGate = new ActionPolicyGate({
    policyStore,
    approvalCoordinator,
    getApprovalSessionsInterface: () => capabilities.consume('agents.approval-sessions-interface', 'policies'),
  })

  capabilities.provide('policies.store', 'policies', policyStore)
  capabilities.provide('policies.approval-coordinator', 'policies', approvalCoordinator)
  capabilities.provide('policies.action-gate', 'policies', actionPolicyGate)

  return null
}

export function createPoliciesRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context
  const approvalCoordinator = capabilities.consume('policies.approval-coordinator', 'policies')

  const policies = createPoliciesRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
    policyStore: capabilities.consume('policies.store', 'policies'),
    approvalCoordinator,
    approvalSessionsInterface: capabilities.consume('agents.approval-sessions-interface', 'policies'),
    actionPolicyGate: capabilities.consume('policies.action-gate', 'policies'),
  })

  return {
    name: 'policies',
    routeIds: ['policies.api', 'approval-check.api'],
    mountStrategy: 'common-static-prefix',
    router: policies.router,
    shutdown: () => approvalCoordinator.shutdown(),
  }
}

export function createApprovalsRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context
  const commanderDataDir = capabilities.consume('commanders.data-dir', 'approvals')
  const commanderStore = capabilities.consume('commanders.store', 'approvals')
  const approvals = createApprovalsRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
    approvalCoordinator: capabilities.consume('policies.approval-coordinator', 'approvals'),
    approvalSessionsInterface: capabilities.consume('agents.approval-sessions-interface', 'approvals'),
    buildCommanderNameLookup: async () => {
      try {
        const [sessions, displayNames] = await Promise.all([
          commanderStore.list(),
          readCommanderDisplayNames(commanderDataDir),
        ])
        const sessionsById = new Map(sessions.map((session) => [session.id, session]))
        return (commanderId) => {
          if (!commanderId) return null
          const session = sessionsById.get(commanderId)
          const future = session as (typeof session & { displayName?: string }) | undefined
          return future?.displayName?.trim() || displayNames[commanderId]?.trim() || session?.host || null
        }
      } catch (err) {
        console.error('[approvals] commander name lookup failed', err)
        return () => null
      }
    },
  })

  capabilities.provide('approvals.pending-stream', 'approvals', approvals.router)

  return {
    name: 'approvals',
    routeIds: ['approvals.api'],
    router: approvals.router,
    handleUpgrade: approvals.handleUpgrade,
  }
}
