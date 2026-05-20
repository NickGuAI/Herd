import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createConversationRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const commanders = context.capabilities.consume('commanders.runtime', 'conversation')

  return {
    name: 'conversation',
    routeIds: ['conversation.api'],
    router: commanders.conversationRouter,
    ...(commanders.handleConversationUpgrade
      ? { handleUpgrade: commanders.handleConversationUpgrade }
      : {}),
  }
}
