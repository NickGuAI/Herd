/**
 * Approval sessions interface — the implementation that backs
 * ApprovalSessionsInterface declared in `./types.ts`.
 *
 * Extracted from `createAgentsRouter()` inside `routes.ts` in issue/921
 * Phase P6a so the approval-queue surface lives in a focused module. Pair
 * of the sessionsInterface extraction landed in PR #1130 (P5).
 *
 * Like commander-interface.ts, this depends on router-local closures that
 * cannot be module-imported (they read/write the router's mutable state).
 * Those dependencies are passed through `ApprovalInterfaceContext` at
 * construction time so the contract is explicit and unit-testable.
 */
import { parseCodexApprovalId } from './codex-approval.js'
import { readClaudeSessionId } from './providers/provider-session-context.js'
import type { ApprovalBridgeTokenClaims } from '../policies/approval-bridge-token.js'
import type { PersistenceHelpers } from './persistence-helpers.js'
import type {
  AnySession,
  AgentsRouterOptions,
  ApprovalBridgeConversationState,
  ApprovalBridgeCredentialInspection,
  ApprovalSessionContext,
  ApprovalSessionsInterface,
  CodexApprovalDecision,
  CodexApprovalQueueEvent,
  CodexPendingApprovalRequest,
  PendingCodexApprovalView,
  PersistedStreamSession,
  StreamSession,
} from './types.js'

/** Signature for the router's helper that resolves a session's commander scope id. */
export type ApprovalCommanderScopeResolver = (session: StreamSession) => string | undefined

/** Signature for the router's pending-approval projection helper. */
export type PendingCodexApprovalProjection = (
  session: StreamSession,
  pendingRequest: CodexPendingApprovalRequest,
) => PendingCodexApprovalView

/** Signature for the router's codex approval-decision applier. */
export type CodexApprovalDecider = (
  session: StreamSession,
  requestId: number,
  decision: CodexApprovalDecision,
) => { ok: true } | {
  ok: false
  code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
  reason: string
}

/**
 * Every router-local closure the ApprovalSessionsInterface implementation
 * needs. Kept explicit so future changes to the approval-queue dependency
 * set show up in the type, not in hidden closure references.
 */
export interface ApprovalInterfaceContext {
  sessions: Map<string, AnySession>
  codexApprovalQueueSubscribers: Set<(event: CodexApprovalQueueEvent) => void>
  getApprovalCommanderScopeId: ApprovalCommanderScopeResolver
  toPendingCodexApprovalView: PendingCodexApprovalProjection
  applyCodexApprovalDecision: CodexApprovalDecider
  /**
   * Resolve a conversation's status + approval bridge credential from
   * canonical conversation state. Absent in deployments without the
   * commanders conversation store, in which case bridge validation keeps the
   * legacy session-scoped semantics.
   */
  getConversationApprovalBridgeState?: (
    conversationId: string,
  ) => Promise<ApprovalBridgeConversationState | null>
  /**
   * Resolve a session name to its conversation id from persisted session
   * rows. Backs the v2-grace path when no live session holds the name
   * (server restart, teardown gap).
   */
  resolvePersistedSessionConversationId?: (
    sessionName: string,
  ) => Promise<string | undefined>
  /**
   * Resolve a conversation's last persisted runtime policy snapshot. This is
   * the no-live authority for cwd and active skill context during handoffs.
   */
  resolvePersistedConversationPolicyContext?: (
    conversationId: string,
    commanderId: string,
  ) => Promise<ApprovalSessionContext | null>
}

type ConversationStore = AgentsRouterOptions['commanderConversationStore']
type PersistenceGetter = () => Pick<PersistenceHelpers, 'readPersistedSessionsState'>
type SessionBridgeDeps = Required<Pick<
  ApprovalInterfaceContext,
  | 'getConversationApprovalBridgeState'
  | 'resolvePersistedSessionConversationId'
  | 'resolvePersistedConversationPolicyContext'
>>

type PersistedConversationPolicySession = PersistedStreamSession & {
  agentType: 'claude'
  sessionType: 'commander'
  creator: { kind: 'commander'; id: string }
}

function compareNewestPolicySession(
  left: Pick<PersistedStreamSession, 'createdAt' | 'name'>,
  right: Pick<PersistedStreamSession, 'createdAt' | 'name'>,
): number {
  return right.createdAt.localeCompare(left.createdAt)
    || left.name.localeCompare(right.name)
}

function isPersistedConversationPolicySession(
  entry: PersistedStreamSession,
  conversationId: string,
  commanderId: string,
): entry is PersistedConversationPolicySession {
  return entry.conversationId?.trim() === conversationId
    && entry.agentType === 'claude'
    && entry.sessionType === 'commander'
    && (entry.transportType === undefined || entry.transportType === 'stream')
    && entry.creator?.kind === 'commander'
    && entry.creator.id?.trim() === commanderId
}

function selectPersistedConversationSession(
  sessions: PersistedStreamSession[],
  conversationId: string,
  commanderId: string,
): PersistedConversationPolicySession | undefined {
  const matches = sessions.filter((entry): entry is PersistedConversationPolicySession => (
    isPersistedConversationPolicySession(entry, conversationId, commanderId)
  ))
  const active = matches.filter((entry) => entry.sessionState !== 'exited')
  const candidates = active.length > 0 ? active : matches
  return candidates.sort(compareNewestPolicySession)[0]
}

/**
 * Bind conversation-owned approval credentials to the router's canonical
 * conversation and persisted-session stores. Provider replacement only
 * reuses these resolvers; it never owns or rotates the credential itself.
 */
export const approvalBridgeDeps = {
  provider(
    approvalBridgeSigningSecret: string | undefined,
    conversationStore: ConversationStore,
  ) {
    return {
      approvalBridgeSigningSecret,
      async resolveConversationApprovalBridgeCredential(conversationId: string) {
        const credential = await conversationStore?.ensureApprovalBridgeCredential(conversationId)
        return credential
          ? { credentialId: credential.credentialId, epoch: credential.epoch }
          : null
      },
    }
  },

  sessions(
    conversationStore: ConversationStore,
    getPersistenceHelpers: PersistenceGetter,
  ): SessionBridgeDeps {
    return {
      async getConversationApprovalBridgeState(conversationId) {
        const conversation = await conversationStore?.get(conversationId)
        if (!conversation) {
          return null
        }
        return {
          status: conversation.status,
          commanderId: conversation.commanderId,
          approvalBridge: conversation.approvalBridge
            ? {
              credentialId: conversation.approvalBridge.credentialId,
              epoch: conversation.approvalBridge.epoch,
            }
            : undefined,
        }
      },

      async resolvePersistedSessionConversationId(sessionName) {
        const state = await getPersistenceHelpers()
          .readPersistedSessionsState()
          .catch(() => ({ sessions: [] }))
        const entry = state.sessions.find((candidate) => candidate.name === sessionName)
        return entry?.conversationId?.trim() || undefined
      },

      async resolvePersistedConversationPolicyContext(conversationId, commanderId) {
        const normalizedConversationId = conversationId.trim()
        const normalizedCommanderId = commanderId.trim()
        if (!normalizedConversationId || !normalizedCommanderId) {
          return null
        }
        const state = await getPersistenceHelpers()
          .readPersistedSessionsState()
          .catch(() => ({ sessions: [] }))
        const entry = selectPersistedConversationSession(
          state.sessions,
          normalizedConversationId,
          normalizedCommanderId,
        )
        if (!entry) {
          return null
        }

        return {
          sessionName: entry.name,
          sessionType: entry.sessionType,
          creator: { ...entry.creator },
          agentType: entry.agentType,
          mode: entry.mode,
          cwd: entry.cwd,
          host: entry.host,
          commanderScopeId: normalizedCommanderId,
          conversationId: normalizedConversationId,
          currentSkillInvocation: entry.currentSkillInvocation
            ? { ...entry.currentSkillInvocation }
            : undefined,
        }
      },
    }
  },
}

/**
 * Construct the approval-sessions interface backed by the given router
 * context. Behavior is identical to the pre-#921-P6a inline object literal;
 * pure refactor.
 */
export function createApprovalSessionsInterface(
  ctx: ApprovalInterfaceContext,
): ApprovalSessionsInterface {
  const {
    sessions,
    codexApprovalQueueSubscribers,
    getApprovalCommanderScopeId,
    toPendingCodexApprovalView,
    applyCodexApprovalDecision,
    getConversationApprovalBridgeState,
    resolvePersistedSessionConversationId,
    resolvePersistedConversationPolicyContext,
  } = ctx

  /**
   * Project a StreamSession into the lightweight ApprovalSessionContext
   * consumed by approval-policy code.
   */
  function projectSessionContext(session: StreamSession): ApprovalSessionContext {
    return {
      sessionName: session.name,
      sessionType: session.sessionType,
      creator: session.creator,
      agentType: session.agentType,
      mode: session.mode,
      cwd: session.cwd,
      host: session.host,
      commanderScopeId: getApprovalCommanderScopeId(session),
      conversationId: session.conversationId,
      currentSkillInvocation: session.currentSkillInvocation
        ? { ...session.currentSkillInvocation }
        : undefined,
    }
  }

  /**
   * Legacy session-scoped bridge check: the token nonce must equal the nonce
   * on the owning live stream/PTY session. Retained for sessions that have no
   * conversation authority (non-conversation workers, PTY terminals).
   */
  function inspectSessionScopedBridgeNonce(sessionName: string, nonce: string): {
    ok: true
  } | {
    ok: false
    reason: 'session_not_live' | 'nonce_mismatch'
  } {
    const session = sessions.get(sessionName.trim())
    if (!session || (session.kind !== 'stream' && session.kind !== 'pty')) {
      return { ok: false, reason: 'session_not_live' }
    }
    const expectedNonce = session?.approvalBridgeNonce?.trim()
    if (!expectedNonce || expectedNonce !== nonce.trim()) {
      return { ok: false, reason: 'nonce_mismatch' }
    }
    return { ok: true }
  }

  /**
   * Conversation authority: a bridge credential is valid while its
   * conversation is known and non-revoked and the credential id/epoch match.
   * There is deliberately NO live-session requirement and NO provider
   * generation/lease/retirement gate — old provider processes keep passing
   * checks for their conversation after any replacement, rotation, recovery,
   * or server restart. Every accepted check still flows through the
   * auto/review/block policy gate.
   */
  async function inspectConversationCredential(
    conversationId: string,
    credential?: { credentialId: string; epoch: number },
  ): Promise<ApprovalBridgeCredentialInspection | null> {
    if (!getConversationApprovalBridgeState) {
      return null
    }
    const conversation = await getConversationApprovalBridgeState(conversationId)
    if (!conversation) {
      return credential
        ? { ok: false, reason: 'conversation_revoked' }
        : null
    }
    if (conversation.status === 'archived') {
      return { ok: false, reason: 'conversation_revoked' }
    }
    if (credential) {
      const bridge = conversation.approvalBridge
      if (
        !bridge
        || bridge.credentialId !== credential.credentialId
        || bridge.epoch !== credential.epoch
      ) {
        return { ok: false, reason: 'credential_revoked' }
      }
      return { ok: true, conversationId }
    }
    // v2 grace: the token predates conversation credentials, so it carries no
    // epoch. It stays valid while the conversation's credential is still on
    // its first epoch; an explicit operator rotation revokes it too.
    if ((conversation.approvalBridge?.epoch ?? 1) !== 1) {
      return { ok: false, reason: 'credential_revoked' }
    }
    return { ok: true, conversationId }
  }

  async function inspectApprovalBridgeCredential(
    claims: ApprovalBridgeTokenClaims,
  ): Promise<ApprovalBridgeCredentialInspection> {
    if (claims.v === 3) {
      const inspected = await inspectConversationCredential(claims.conversationId.trim(), {
        credentialId: claims.credentialId,
        epoch: claims.epoch,
      })
      // Conversation-scoped tokens are only mintable when conversation state
      // exists, so an unresolvable conversation store means the credential
      // cannot be validated — fail closed as revoked.
      return inspected ?? { ok: false, reason: 'conversation_revoked' }
    }

    const sessionName = claims.sessionName.trim()
    const session = sessions.get(sessionName)
    if (session && (session.kind === 'stream' || session.kind === 'pty')) {
      const conversationId = session.kind === 'stream'
        ? session.conversationId?.trim()
        : undefined
      if (conversationId) {
        // v2 grace (deploy transparency): resolve the session name to its
        // conversation and accept while the conversation remains valid, so
        // processes holding pre-upgrade tokens survive the deploy and any
        // later provider replacement. When no conversation record exists the
        // session keeps its legacy session-scoped semantics.
        const inspected = await inspectConversationCredential(conversationId)
        if (inspected) {
          return inspected
        }
      }
      return inspectSessionScopedBridgeNonce(sessionName, claims.nonce)
    }

    // No live session holds this name (server restart or a replacement
    // teardown gap): resolve the conversation from persisted session rows —
    // the conversation, not the provider session, is the authority.
    const persistedConversationId = await resolvePersistedSessionConversationId?.(sessionName)
    if (persistedConversationId) {
      const inspected = await inspectConversationCredential(persistedConversationId)
      if (inspected) {
        return inspected
      }
    }
    return { ok: false, reason: 'session_not_live' }
  }

  return {
    getSessionContext(name) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return null
      }
      return projectSessionContext(session)
    },

    findSessionContextByClaudeSessionId(sessionId) {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId) {
        return null
      }
      for (const session of sessions.values()) {
        if (
          session.kind === 'stream'
          && session.agentType === 'claude'
          && readClaudeSessionId(session) === normalizedSessionId
        ) {
          return projectSessionContext(session)
        }
      }
      return null
    },

    getLiveSession(name) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return null
      }
      return session
    },

    findLiveSessionByClaudeSessionId(sessionId) {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId) {
        return null
      }
      for (const session of sessions.values()) {
        if (
          session.kind === 'stream'
          && session.agentType === 'claude'
          && readClaudeSessionId(session) === normalizedSessionId
        ) {
          return session
        }
      }
      return null
    },

    findLiveSessionByConversationId(conversationId) {
      const normalizedConversationId = conversationId.trim()
      if (!normalizedConversationId) {
        return null
      }
      for (const session of sessions.values()) {
        if (
          session.kind === 'stream'
          && session.conversationId?.trim() === normalizedConversationId
        ) {
          return session
        }
      }
      return null
    },

    async resolveConversationPolicyContext(conversationId) {
      const normalizedConversationId = conversationId.trim()
      if (!normalizedConversationId) {
        return null
      }
      const conversation = await getConversationApprovalBridgeState?.(normalizedConversationId)
      const commanderId = conversation?.commanderId?.trim()
      if (!conversation || conversation.status === 'archived' || !commanderId) {
        return null
      }
      const liveSession = [...sessions.values()]
        .filter((session): session is StreamSession => (
          session.kind === 'stream'
          && session.conversationId?.trim() === normalizedConversationId
          && session.agentType === 'claude'
          && session.sessionType === 'commander'
          && session.creator.kind === 'commander'
          && session.creator.id?.trim() === commanderId
        ))
        .sort(compareNewestPolicySession)[0]
      if (liveSession) {
        return projectSessionContext(liveSession)
      }
      return await resolvePersistedConversationPolicyContext?.(
        normalizedConversationId,
        commanderId,
      ) ?? null
    },

    inspectApprovalBridgeCredential,

    validateApprovalBridgeCredential(sessionName, nonce) {
      return inspectSessionScopedBridgeNonce(sessionName, nonce).ok
    },

    listPendingCodexApprovals() {
      const pending: PendingCodexApprovalView[] = []
      for (const session of sessions.values()) {
        if (session.kind !== 'stream' || session.agentType !== 'codex') {
          continue
        }
        for (const request of session.codexPendingApprovals.values()) {
          pending.push(toPendingCodexApprovalView(session, request))
        }
      }
      pending.sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      return pending
    },

    resolvePendingCodexApproval(approvalId, decision) {
      const parsed = parseCodexApprovalId(approvalId)
      if (!parsed) {
        return {
          ok: false as const,
          code: 'not_found' as const,
          reason: `Codex approval "${approvalId}" not found`,
        }
      }

      const session = sessions.get(parsed.sessionName)
      if (!session || session.kind !== 'stream') {
        return {
          ok: false as const,
          code: 'not_found' as const,
          reason: `Codex approval "${approvalId}" not found`,
        }
      }

      return applyCodexApprovalDecision(session, parsed.requestId, decision)
    },

    subscribeToCodexApprovalQueue(listener) {
      codexApprovalQueueSubscribers.add(listener)
      return () => {
        codexApprovalQueueSubscribers.delete(listener)
      }
    },
  }
}
