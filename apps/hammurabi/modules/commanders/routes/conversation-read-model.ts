import { liveSessionToApiPayload } from '../../agents/session/state.js'
import { getProvider } from '../../agents/providers/registry.js'
import type { AgentSession, AgentType, StreamSession } from '../../agents/types.js'
import { buildDefaultCommanderConversationId } from '../store.js'
import type { Conversation } from '../conversation-store.js'
import type { CommanderRoutesContext } from './types.js'
import {
  buildConversationSessionName,
  getLiveConversationSession,
} from './conversation-runtime.js'

type ConversationAction =
  | 'send'
  | 'queue'
  | 'media'
  | 'start'
  | 'pause'
  | 'resume'
  | 'archive'
  | 'delete'
  | 'updateProvider'

type ConversationDisabledReasons = Record<ConversationAction, string | null>
type ConversationAllowedActions = Record<ConversationAction, boolean>
type ConversationTransportType = 'stream' | 'pty' | 'external' | null

interface LiveConversationSessionLike {
  kind?: string
  agentType?: AgentType
}

/**
 * Backend-owned conversation read model for Command Room clients.
 *
 * The DTO keeps the persisted conversation fields for compatibility, then adds
 * the projected lifecycle/sendability contract desktop and mobile should
 * consume instead of parsing session names or raw live-session process fields.
 */
export interface ConversationSummaryDTO extends Conversation {
  isDefaultConversation: boolean
  liveSession: AgentSession | null
  canonicalOrder: number
  displayState: {
    status: Conversation['status']
    isVisible: boolean
    isDefaultConversation: boolean
    hasLiveSession: boolean
    isSendable: boolean
    isQueueable: boolean
    isMediaSendable: boolean
    label: string
    disabledReasons: ConversationDisabledReasons
  }
  sendTarget: null | {
    kind: 'conversation'
    conversationId: string
    commanderId: string
    sessionName: string
    transportType: ConversationTransportType
    agentType: AgentType | null
    queue: {
      supported: boolean
      reason: string | null
    }
    media: {
      supported: boolean
      reason: string | null
    }
  }
  allowedActions: ConversationAllowedActions
}

function resolveTransportType(liveSession: LiveConversationSessionLike | undefined): ConversationTransportType {
  if (!liveSession) {
    return null
  }
  return liveSession.kind === 'stream' || liveSession.kind === 'pty' || liveSession.kind === 'external'
    ? liveSession.kind
    : null
}

function serializeLiveSession(liveSession: LiveConversationSessionLike | undefined): AgentSession | null {
  if (!liveSession) {
    return null
  }
  if (liveSession.kind === 'stream') {
    return liveSessionToApiPayload(liveSession as StreamSession)
  }

  return {
    name: (liveSession as { name?: string }).name ?? '',
    created: (liveSession as { createdAt?: string }).createdAt ?? new Date(0).toISOString(),
    lastActivityAt: (liveSession as { lastEventAt?: string }).lastEventAt ?? new Date(0).toISOString(),
    pid: 0,
    transportType: resolveTransportType(liveSession) ?? 'stream',
    processAlive: false,
    hadResult: false,
    status: 'idle',
    ...(liveSession.agentType ? { agentType: liveSession.agentType } : {}),
  } as AgentSession
}

function buildLabel(conversation: Conversation): string {
  const name = conversation.name?.trim()
  if (name) {
    return name
  }
  const displayName = conversation.channelMeta?.displayName?.trim()
  if (displayName) {
    return displayName
  }
  return `Conversation ${conversation.id.slice(0, 8)}`
}

function providerSupportsMessageImages(liveSession: LiveConversationSessionLike | undefined): boolean {
  if (!liveSession?.agentType) {
    return false
  }
  return getProvider(liveSession.agentType)?.capabilities.supportsMessageImages === true
}

export function buildConversationSummaryDTO(
  context: CommanderRoutesContext,
  conversation: Conversation,
  canonicalOrder = 0,
): ConversationSummaryDTO {
  const liveSession = getLiveConversationSession(context, conversation) as LiveConversationSessionLike | undefined
  const transportType = resolveTransportType(liveSession)
  const hasLiveSession = Boolean(liveSession)
  const isDefaultConversation = conversation.id === buildDefaultCommanderConversationId(conversation.commanderId)
  const sessionName = buildConversationSessionName(conversation)
  const hasActiveStream = conversation.status === 'active' && transportType === 'stream'
  const isArchived = conversation.status === 'archived'
  const canStartOrResume = conversation.status === 'idle' && !hasLiveSession

  const noActiveStreamReason = 'Conversation image transport requires an active stream session'
  const canSendMedia = hasActiveStream && providerSupportsMessageImages(liveSession)
  const sendReason = isArchived
    ? 'Conversation is archived'
    : hasActiveStream
      ? null
      : conversation.status !== 'active'
        ? 'Conversation must be active before sending'
        : transportType === null
          ? 'Conversation has no live session'
          : 'Conversation live session is not stream-sendable'
  const queueReason = hasActiveStream ? null : sendReason
  const mediaReason = canSendMedia
    ? null
    : hasActiveStream
      ? 'Conversation provider does not support image attachments'
      : noActiveStreamReason

  const allowedActions: ConversationAllowedActions = {
    send: hasActiveStream,
    queue: hasActiveStream,
    media: canSendMedia,
    start: canStartOrResume,
    pause: conversation.status === 'active' && !isArchived,
    resume: canStartOrResume,
    archive: true,
    delete: true,
    updateProvider: conversation.status === 'idle' && !hasLiveSession,
  }
  const disabledReasons: ConversationDisabledReasons = {
    send: allowedActions.send ? null : sendReason,
    queue: allowedActions.queue ? null : queueReason,
    media: allowedActions.media ? null : mediaReason,
    start: allowedActions.start
      ? null
      : isArchived
        ? 'Archived conversations cannot be started'
        : hasLiveSession
          ? 'Conversation already has a live session'
          : 'Conversation is not idle',
    pause: allowedActions.pause
      ? null
      : isArchived
        ? 'Archived conversations cannot be paused'
        : 'Conversation is not active',
    resume: allowedActions.resume
      ? null
      : isArchived
        ? 'Archived conversations cannot be resumed'
        : hasLiveSession
          ? 'Conversation already has a live session'
          : 'Conversation is not idle',
    archive: null,
    delete: null,
    updateProvider: allowedActions.updateProvider
      ? null
      : isArchived
        ? 'Archived conversations cannot change provider'
        : hasLiveSession || conversation.status === 'active'
          ? 'Stop the conversation before changing provider or model'
          : 'Conversation provider cannot be updated in the current state',
  }

  const queueSupport = {
    supported: allowedActions.queue,
    reason: disabledReasons.queue,
  }
  const mediaSupport = {
    supported: allowedActions.media,
    reason: disabledReasons.media,
  }

  return {
    ...conversation,
    isDefaultConversation,
    liveSession: serializeLiveSession(liveSession),
    canonicalOrder,
    displayState: {
      status: conversation.status,
      isVisible: conversation.status !== 'archived',
      isDefaultConversation,
      hasLiveSession,
      isSendable: allowedActions.send,
      isQueueable: allowedActions.queue,
      isMediaSendable: allowedActions.media,
      label: buildLabel(conversation),
      disabledReasons,
    },
    sendTarget: isArchived
      ? null
      : {
          kind: 'conversation',
          conversationId: conversation.id,
          commanderId: conversation.commanderId,
          sessionName,
          transportType,
          agentType: liveSession?.agentType ?? conversation.agentType ?? null,
          queue: queueSupport,
          media: mediaSupport,
        },
    allowedActions,
  }
}
