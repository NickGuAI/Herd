import {
  clearCodexTurnWatchdog,
  markCodexTurnHealthy,
} from '../adapters/codex/helpers.js'
import { getProvider } from '../providers/registry.js'
import {
  ensureClaudeProviderContext,
  readClaudeSessionId,
} from '../providers/provider-session-context.js'
import {
  appendCommanderTranscriptEvent,
  appendGenericTranscriptEvent,
} from './persistence.js'
import {
  applyStreamUsageEvent,
} from './helpers.js'
import {
  unknownToErrorCode,
  unknownToErrorText,
} from './provider-runtime.js'
import {
  extractTranscriptUsageUpdate,
  isTranscriptExitRecord,
  isTranscriptTurnEndRecord,
  isTranscriptTurnStartRecord,
  readTranscriptEnvelopeSessionId,
} from '../transcript-records.js'
import { extractProviderLimitDetails } from '../provider-errors.js'
import { isTranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import {
  extractClaudeSessionId,
} from './state.js'
import { MAX_STREAM_EVENTS } from '../constants.js'
import {
  getNextStreamEventSeq,
  stampStreamEventSeq,
} from '../messages/canonical-timeline.js'
import type {
  CommanderTranscriptAppender,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

interface StreamEventQueueRuntime {
  broadcastQueueUpdate(session: StreamSession): void
  clearQueuedMessageRetry(session: StreamSession): void
  getQueuedBacklogCount(session: StreamSession): number
  resetQueuedMessageRetryDelay(session: StreamSession): void
  scheduleQueuedMessageDrain(session: StreamSession, options?: { force?: boolean }): void
}

interface StreamEventAutoRotationRuntime {
  supportsAutoRotation(session: StreamSession): boolean
  scheduleAutoRotationIfNeeded(sessionName: string): void
}

interface StreamEventProviderRuntime {
  scheduleCodexTurnWatchdog(session: StreamSession): void
  handleUsageLimitSignal(
    session: StreamSession,
    options?: {
      resetAt?: string
      interruptedMessage?: StreamSession['currentQueuedMessage']
      interruptedTurnHadSideEffects?: boolean
      interruptedTurnId?: string
    },
  ): void
  handleAuthRequiredSignal(
    session: StreamSession,
    detail: string,
    options?: {
      interruptedMessage?: StreamSession['currentQueuedMessage']
      interruptedTurnHadSideEffects?: boolean
      interruptedTurnId?: string
    },
  ): void
}

interface StreamEventApprovalRuntime {
  clearCodexPendingApprovals(session: StreamSession): void
}

interface StreamEventAppenderDeps {
  autoRotateEntryThreshold: number
  commanderTranscriptAppender?: CommanderTranscriptAppender
  getQueueRuntime(): StreamEventQueueRuntime
  getAutoRotationRuntime(): StreamEventAutoRotationRuntime
  getProviderRuntime(): StreamEventProviderRuntime
  getApprovalRuntime(): StreamEventApprovalRuntime
  schedulePersistedSessionsWrite(): void
}

export function createStreamEventAppender(
  deps: StreamEventAppenderDeps,
): (session: StreamSession, event: StreamJsonEvent) => void {
  function findCurrentTurnBoundaryIndex(events: readonly StreamJsonEvent[]): number {
    for (let index = events.length - 2; index >= 0; index -= 1) {
      if (isTranscriptTurnStartRecord(events[index]!)) {
        return index
      }
      if (isTranscriptTurnEndRecord(events[index]!) || isTranscriptExitRecord(events[index]!)) {
        return index + 1
      }
    }
    return 0
  }

  function currentTurnHadSideEffects(events: readonly StreamJsonEvent[], turnBoundaryIndex: number): boolean {
    if (!isTranscriptTurnStartRecord(events[turnBoundaryIndex]!)) {
      // If the current turn boundary was truncated or never observed, replay is
      // not provably side-effect free. Prefer a guarded continuation.
      return true
    }
    return events.slice(turnBoundaryIndex).some((candidate) => {
      if (!isTranscriptEnvelope(candidate)) {
        return false
      }
      return candidate.ev.type === 'tool.start'
        || candidate.ev.type === 'tool.end'
        || candidate.ev.type === 'file.change'
    })
  }

  function findCurrentTurnUsageLimit(events: readonly StreamJsonEvent[], turnBoundaryIndex: number): { resetAt?: string } | null {
    for (let index = events.length - 1; index >= turnBoundaryIndex; index -= 1) {
      const candidate = events[index]!
      if (!isTranscriptEnvelope(candidate)) {
        continue
      }
      if (candidate.ev.type === 'provider.error' && candidate.ev.classification === 'usage_limit') {
        return {
          ...(candidate.ev.resetAt ? { resetAt: candidate.ev.resetAt } : {}),
        }
      }
      if (candidate.ev.type === 'turn.end') {
        const errorText = [
          unknownToErrorText(candidate.ev.error),
          unknownToErrorText(candidate.ev.result),
        ].filter(Boolean).join('\n')
        const code = unknownToErrorCode(candidate.ev.error) ?? unknownToErrorCode(candidate.ev.result)
        const details = extractProviderLimitDetails(errorText, code, { referenceTime: candidate.time })
        if (Boolean(errorText || code) && details.classification === 'usage_limit') {
          return {
            ...(details.resetAt ? { resetAt: details.resetAt } : {}),
          }
        }
      }
    }
    return null
  }

  function findCurrentTurnAuthRequired(
    events: readonly StreamJsonEvent[],
    turnBoundaryIndex: number,
  ): string | null {
    for (let index = events.length - 1; index >= turnBoundaryIndex; index -= 1) {
      const candidate = events[index]!
      if (!isTranscriptEnvelope(candidate)) {
        continue
      }
      if (candidate.ev.type === 'provider.error' && candidate.ev.classification === 'auth_required') {
        return candidate.ev.message || 'Claude authentication is required'
      }
      if (candidate.ev.type === 'turn.end') {
        const errorText = [
          unknownToErrorText(candidate.ev.error),
          unknownToErrorText(candidate.ev.result),
        ].filter(Boolean).join('\n')
        const code = unknownToErrorCode(candidate.ev.error) ?? unknownToErrorCode(candidate.ev.result)
        if (
          Boolean(errorText || code)
          && extractProviderLimitDetails(errorText, code, { referenceTime: candidate.time }).classification === 'auth_required'
        ) {
          return errorText || code || 'Claude authentication is required'
        }
      }
    }
    return null
  }

  return function appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void {
    const nextSeq = session.nextEventSeq ?? getNextStreamEventSeq(session.events)
    session.nextEventSeq = nextSeq + 1
    const sequencedEvent = stampStreamEventSeq(event, nextSeq)
    session.lastEventAt = new Date().toISOString()
    session.events.push(sequencedEvent)
    if (session.events.length > MAX_STREAM_EVENTS) {
      session.events = session.events.slice(-MAX_STREAM_EVENTS)
    }

    const provider = getProvider(session.agentType)
    const usesRuntimeWatchdog = Boolean(provider?.runtimeWatchdog)
    const persistsResumeFromEvents = session.agentType === 'claude'
    if (isTranscriptTurnStartRecord(sequencedEvent)) {
      const wasCompleted = session.lastTurnCompleted
      const isCompletedOneShot =
        (
          session.sessionType === 'cron' ||
          session.sessionType === 'sentinel' ||
          session.sessionType === 'automation'
        ) &&
        Boolean(session.finalResultEvent)
      if (!isCompletedOneShot) {
        session.lastTurnCompleted = false
        session.completedTurnAt = undefined
        session.finalResultEvent = undefined
        session.restoredIdle = false
      }
      if (usesRuntimeWatchdog) {
        deps.getApprovalRuntime().clearCodexPendingApprovals(session)
        deps.getProviderRuntime().scheduleCodexTurnWatchdog(session)
      }
      if (wasCompleted && persistsResumeFromEvents) {
        deps.schedulePersistedSessionsWrite()
      }
    }
    if (isTranscriptTurnEndRecord(sequencedEvent)) {
      const queueRuntime = deps.getQueueRuntime()
      const autoRotation = deps.getAutoRotationRuntime()
      const wasCompleted = session.lastTurnCompleted
      const turnBoundaryIndex = findCurrentTurnBoundaryIndex(session.events)
      const usageLimit = findCurrentTurnUsageLimit(session.events, turnBoundaryIndex)
      const authRequired = findCurrentTurnAuthRequired(session.events, turnBoundaryIndex)
      const interruptedMessage = usageLimit || authRequired
        ? session.activeTurnMessage ?? session.currentQueuedMessage
        : undefined
      session.lastTurnCompleted = true
      session.completedTurnAt = new Date().toISOString()
      session.finalResultEvent = event
      if (!wasCompleted) {
        session.conversationEntryCount += 1
      }
      if (!wasCompleted && persistsResumeFromEvents) {
        deps.schedulePersistedSessionsWrite()
      }
      if (usesRuntimeWatchdog) {
        deps.getApprovalRuntime().clearCodexPendingApprovals(session)
        clearCodexTurnWatchdog(session)
        markCodexTurnHealthy(session)
      }
      if (
        !wasCompleted &&
        autoRotation.supportsAutoRotation(session) &&
        session.conversationEntryCount >= deps.autoRotateEntryThreshold
      ) {
        session.autoRotatePending = true
      }
      if (usageLimit && session.credentialPoolId) {
        deps.getProviderRuntime().handleUsageLimitSignal(session, {
          ...(usageLimit.resetAt ? { resetAt: usageLimit.resetAt } : {}),
          ...(interruptedMessage ? { interruptedMessage } : {}),
          interruptedTurnHadSideEffects: currentTurnHadSideEffects(session.events, turnBoundaryIndex),
          ...(isTranscriptEnvelope(sequencedEvent) && sequencedEvent.turnId
            ? { interruptedTurnId: sequencedEvent.turnId }
            : {}),
        })
      }
      if (authRequired && session.credentialPoolId) {
        deps.getProviderRuntime().handleAuthRequiredSignal(session, authRequired, {
          ...(interruptedMessage ? { interruptedMessage } : {}),
          interruptedTurnHadSideEffects: currentTurnHadSideEffects(session.events, turnBoundaryIndex),
          ...(isTranscriptEnvelope(sequencedEvent) && sequencedEvent.turnId
            ? { interruptedTurnId: sequencedEvent.turnId }
            : {}),
        })
      }
      if (session.activeTurnMessage) {
        session.activeTurnMessage = undefined
        deps.schedulePersistedSessionsWrite()
      }
      if (session.currentQueuedMessage) {
        session.currentQueuedMessage = undefined
        queueRuntime.clearQueuedMessageRetry(session)
        queueRuntime.resetQueuedMessageRetryDelay(session)
        queueRuntime.broadcastQueueUpdate(session)
        deps.schedulePersistedSessionsWrite()
        if (session.autoRotatePending) {
          autoRotation.scheduleAutoRotationIfNeeded(session.name)
        }
        queueRuntime.scheduleQueuedMessageDrain(session)
      } else if (queueRuntime.getQueuedBacklogCount(session) > 0) {
        if (session.autoRotatePending) {
          autoRotation.scheduleAutoRotationIfNeeded(session.name)
        }
        queueRuntime.scheduleQueuedMessageDrain(session)
      } else if (session.autoRotatePending) {
        autoRotation.scheduleAutoRotationIfNeeded(session.name)
      }
    }
    if (isTranscriptExitRecord(sequencedEvent) && usesRuntimeWatchdog) {
      deps.getApprovalRuntime().clearCodexPendingApprovals(session)
      clearCodexTurnWatchdog(session)
      markCodexTurnHealthy(session)
    }
    applyStreamUsageEvent(session, sequencedEvent)
    const usageUpdate = extractTranscriptUsageUpdate(sequencedEvent)
    if (usageUpdate?.totalCostUsd !== undefined) {
      session.usage.costUsd = usageUpdate.totalCostUsd
    } else if (usageUpdate?.costUsd !== undefined) {
      session.usage.costUsd = usageUpdate.costUsd
    }

    if (persistsResumeFromEvents) {
      const sessionId = extractClaudeSessionId(sequencedEvent) ?? readTranscriptEnvelopeSessionId(sequencedEvent)
      if (sessionId && readClaudeSessionId(session) !== sessionId) {
        ensureClaudeProviderContext(session).sessionId = sessionId
        deps.schedulePersistedSessionsWrite()
      }
    }

    appendCommanderTranscriptEvent(
      session,
      sequencedEvent,
      deps.commanderTranscriptAppender,
      extractClaudeSessionId,
    )
    appendGenericTranscriptEvent(session, sequencedEvent)
  }
}
