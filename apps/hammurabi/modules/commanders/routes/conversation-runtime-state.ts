export type ConversationRuntimeState =
  | 'idle'
  | 'starting'
  | 'active'
  | 'failed'
  | 'archived'

export type ConversationBootstrapOperation = 'start' | 'resume'

export interface ConversationRuntimeOverlay {
  state: 'starting' | 'failed'
  operation: ConversationBootstrapOperation
  generation: number
  startedAt: string
  updatedAt: string
  error: string | null
  cancelRequested: boolean
  cancelStatus: 'idle' | 'archived' | null
}

const runtimeOverlays = new Map<string, ConversationRuntimeOverlay>()

export function beginConversationBootstrap(
  conversationId: string,
  operation: ConversationBootstrapOperation,
  timestamp: string,
): ConversationRuntimeOverlay {
  const previous = runtimeOverlays.get(conversationId)
  const generation = (previous?.generation ?? 0) + 1
  const overlay: ConversationRuntimeOverlay = {
    state: 'starting',
    operation,
    generation,
    startedAt: timestamp,
    updatedAt: timestamp,
    error: null,
    cancelRequested: false,
    cancelStatus: null,
  }
  runtimeOverlays.set(conversationId, overlay)
  return { ...overlay }
}

export function getConversationRuntimeOverlay(
  conversationId: string,
): ConversationRuntimeOverlay | null {
  const overlay = runtimeOverlays.get(conversationId)
  return overlay ? { ...overlay } : null
}

export function completeConversationBootstrap(
  conversationId: string,
  generation: number,
): void {
  const current = runtimeOverlays.get(conversationId)
  if (current?.generation === generation) {
    runtimeOverlays.delete(conversationId)
  }
}

export function failConversationBootstrap(
  conversationId: string,
  generation: number,
  error: string,
  timestamp: string,
): void {
  const current = runtimeOverlays.get(conversationId)
  if (!current || current.generation !== generation) {
    return
  }
  runtimeOverlays.set(conversationId, {
    ...current,
    state: 'failed',
    updatedAt: timestamp,
    error,
  })
}

export function requestConversationBootstrapCancel(
  conversationId: string,
  timestamp: string,
  cancelStatus: 'idle' | 'archived' = 'idle',
): boolean {
  const current = runtimeOverlays.get(conversationId)
  if (current?.state !== 'starting') {
    return false
  }
  runtimeOverlays.set(conversationId, {
    ...current,
    cancelRequested: true,
    cancelStatus,
    updatedAt: timestamp,
  })
  return true
}

export function conversationBootstrapCancelRequested(
  conversationId: string,
  generation: number,
): boolean {
  const current = runtimeOverlays.get(conversationId)
  return current?.generation === generation && current.cancelRequested === true
}

export function getConversationBootstrapCancelStatus(
  conversationId: string,
  generation: number,
): 'idle' | 'archived' | null {
  const current = runtimeOverlays.get(conversationId)
  return current?.generation === generation ? current.cancelStatus : null
}

export function resetConversationRuntimeOverlays(): void {
  runtimeOverlays.clear()
}
