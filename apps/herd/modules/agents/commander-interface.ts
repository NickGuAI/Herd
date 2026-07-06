/**
 * Commander sessions interface — the implementation that backs the
 * CommanderSessionsInterface contract declared in `./types.ts`.
 *
 * Extracted from `createAgentsRouter()` inside `routes.ts` in #921 Phase P5
 * so commander lifecycle lives in a focused module instead of as an inline
 * 157-line object literal nested in a 2300-line router closure.
 *
 * The implementation depends on several router-local factories (session
 * creators, queue plumbing, runtime teardown) that cannot be module-imported
 * because they themselves close over router state. Those dependencies are
 * passed through `CommanderInterfaceContext` at construction time — the
 * router instantiates this interface once and the contract is explicit.
 *
 * Non-closure dependencies stay imported directly so the context interface
 * stays focused on what's actually router-local.
 */
import { SessionMessageQueue, type QueuedMessage, type QueuedMessageImage, type QueuedMessagePriority } from './message-queue.js'
import { WebSocket } from 'ws'
import type { ProviderCreateOptions } from './providers/provider-adapter.js'
import { getProvider } from './providers/registry.js'
import { getNextStreamEventSeq } from './messages/canonical-timeline.js'
import { resolveNativeProviderResumeId } from './providers/native-resume.js'
import type {
  AgentType,
  AnySession,
  ClaudePermissionMode,
  CommanderSessionsInterface,
  CredentialPoolRecoveryRequest,
  MachineConfig,
  SessionSendPayload,
  StreamJsonEvent,
  StreamSession,
} from './types.js'

type ProviderSessionCreateOptions = Omit<
  ProviderCreateOptions,
  'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'
>

export type ProviderSessionCreator = (
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string | undefined,
  machine: MachineConfig | undefined,
  agentType: AgentType,
  options?: ProviderSessionCreateOptions,
) => Promise<StreamSession>

export type SessionTeardown = (session: StreamSession, reason: string) => Promise<void>
export type RuntimeShutdown = (reason?: string) => Promise<void>

export type CreateQueuedMessage = (
  text: string,
  priority: QueuedMessagePriority,
  images?: QueuedMessageImage[],
  displayText?: string,
  clientSendId?: string,
  userEventSubtype?: string,
) => QueuedMessage

export type EnqueueQueuedMessage = (
  session: StreamSession,
  message: QueuedMessage,
) => { ok: true } | { ok: false; error: string }

export type ScheduleQueueDrain = (
  session: StreamSession,
  options?: { force?: boolean },
) => void

/**
 * Signature matches the router's internal `sendImmediateTextToStreamSession`:
 * returns a discriminated-union success/failure result. The commander
 * interface only uses `result.ok`, so we do not model the full success payload
 * here — callers of `sendToSession` return a boolean.
 */
export type SendImmediateText = (
  session: StreamSession,
  text: string,
  images?: QueuedMessageImage[],
  displayText?: string,
  clientSendId?: string,
  userEventSubtype?: string,
) => Promise<
  | { ok: true; queued: boolean; message: QueuedMessage }
  | { ok: false; error: string }
>

/**
 * Every router-local closure the CommanderSessionsInterface implementation
 * needs. Keeping the context explicit means any future change to
 * commander-lifecycle dependencies shows up in the type, not as a hidden
 * closure reference.
 */
export interface CommanderInterfaceContext {
  sessions: Map<string, AnySession>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  schedulePersistedSessionsWrite: () => void

  createProviderStreamSession: ProviderSessionCreator

  createQueuedMessage: CreateQueuedMessage
  enqueueQueuedMessage: EnqueueQueuedMessage
  scheduleQueuedMessageDrain: ScheduleQueueDrain
  sendImmediateTextToStreamSession: SendImmediateText

  teardownProviderSession: SessionTeardown
  shutdownProviderRuntimes: RuntimeShutdown

  getCredentialRecoveryRequest?: (sessionName: string) => CredentialPoolRecoveryRequest | undefined
  clearCredentialRecoveryRequest?: (sessionName: string) => void
  getActiveCredentialPoolId?: (provider: AgentType) => Promise<string | undefined>
}

/**
 * Subset of `CommanderSessionsInterface` covered by this factory. The
 * `dispatchWorkerForCommander` method is composed in by the router itself
 * (issue #1223) because it needs router-local state — the machine registry,
 * `maxSessions` budget, and direct access to the session-creator closures —
 * that is intentionally not part of `CommanderInterfaceContext`. Keeping it
 * out of this factory's return type means the router's compose step is the
 * single place that sees both halves.
 */
export type BaseCommanderSessionsInterface = Omit<
  CommanderSessionsInterface,
  'dispatchWorkerForCommander'
>

type CreateCommanderSessionInput = Parameters<BaseCommanderSessionsInterface['createCommanderSession']>[0]

function clearResumeContextOnCredentialPoolChange(
  input: CreateCommanderSessionInput,
  previous: AnySession | undefined,
): CreateCommanderSessionInput {
  if (
    !input.resumeProviderContext ||
    !input.credentialPoolId ||
    !previous ||
    previous.kind !== 'stream' ||
    !previous.credentialPoolId ||
    previous.credentialPoolId === input.credentialPoolId
  ) {
    return input
  }

  return {
    ...input,
    resumeProviderContext: undefined,
  }
}

function normalizeSendPayload(payload: string | SessionSendPayload): SessionSendPayload {
  if (typeof payload === 'string') {
    return { text: payload }
  }
  const images = payload.images && payload.images.length > 0 ? [...payload.images] : undefined
  const displayText = payload.displayText !== undefined ? payload.displayText.trim() : undefined
  const clientSendId = payload.clientSendId !== undefined ? payload.clientSendId.trim() : undefined
  const userEventSubtype = payload.userEventSubtype !== undefined ? payload.userEventSubtype.trim() : undefined
  return {
    text: payload.text,
    ...(displayText !== undefined ? { displayText } : {}),
    images,
    ...(clientSendId ? { clientSendId } : {}),
    ...(userEventSubtype ? { userEventSubtype } : {}),
  }
}

/**
 * Construct the commander-session interface backed by the given router
 * context. Behavior is identical to the pre-#921-P5 inline object literal
 * that lived in `routes.ts`; this is pure refactor.
 */
export function createCommanderSessionsInterface(
  ctx: CommanderInterfaceContext,
): BaseCommanderSessionsInterface {
  const {
    sessions,
    sessionEventHandlers,
    schedulePersistedSessionsWrite,
    createProviderStreamSession,
    createQueuedMessage,
    enqueueQueuedMessage,
    scheduleQueuedMessageDrain,
    sendImmediateTextToStreamSession,
    teardownProviderSession,
    shutdownProviderRuntimes,
    getCredentialRecoveryRequest,
    clearCredentialRecoveryRequest,
    getActiveCredentialPoolId,
  } = ctx

  async function buildCommanderSession({
    name,
    commanderId,
    conversationId,
    systemPrompt,
    agentType,
    model,
    effort,
    adaptiveThinking,
    maxThinkingTokens,
    cwd,
    resumeProviderContext,
    credentialPoolId,
    maxTurns,
    env,
    gaiaOpsApiKeyExpiresAt,
  }: CreateCommanderSessionInput): Promise<StreamSession> {
    const creator = {
      kind: 'commander' as const,
      id: commanderId?.trim() || name,
    }
    const provider = getProvider(agentType)
    if (!provider) {
      throw new Error(`Unknown provider: ${agentType}`)
    }
    const sessionCwd = cwd ?? process.env.HOME ?? '/tmp'
    const resumeSessionId = resolveNativeProviderResumeId({
      provider,
      agentType,
      providerContext: resumeProviderContext,
      sessionName: name,
      cwd: sessionCwd,
    })
    const baseOptions: ProviderSessionCreateOptions = {
      systemPrompt,
      model,
      effort,
      adaptiveThinking,
      maxThinkingTokens,
      maxTurns,
      sessionType: 'commander',
      creator,
      conversationId,
      resumeProviderContext,
      credentialPoolId,
      env,
    }

    const session = resumeSessionId
      ? await createProviderStreamSession(
        name,
        'default',
        '',
        sessionCwd,
        undefined,
        agentType,
        {
          ...baseOptions,
          resumeSessionId,
        },
      )
      : await createProviderStreamSession(
        name,
        'default',
        '',
        sessionCwd,
        undefined,
        agentType,
        baseOptions,
      )
    if (gaiaOpsApiKeyExpiresAt) {
      session.gaiaOpsApiKeyExpiresAt = gaiaOpsApiKeyExpiresAt
    }
    return session
  }

  return {
    async createCommanderSession(input) {
      const { name } = input
      const session = await buildCommanderSession(
        clearResumeContextOnCredentialPoolChange(input, sessions.get(name)),
      )
      sessions.set(name, session)
      schedulePersistedSessionsWrite()
      return session
    },

    async replaceCommanderSession(input) {
      const { name } = input
      const previous = sessions.get(name)
      const replacement = await buildCommanderSession(
        clearResumeContextOnCredentialPoolChange(input, previous),
      )
      if (previous && previous.kind === 'stream') {
        // Keep the old provider alive until the replacement is ready. If
        // provider auth or remote launch fails above, callers still have the
        // existing runtime instead of a torn-down session slot.
        await teardownProviderSession(previous, `Provider swap on session "${name}"`)
      }
      if (previous && previous.kind === 'stream' && replacement.kind === 'stream') {
        // Mirror websocket.ts auto-rotate replacement so same-name provider
        // swaps preserve replay, usage, entry count, and auto-rotate state.
        replacement.events = previous.events.slice()
        replacement.nextEventSeq = getNextStreamEventSeq(replacement.events)
        replacement.usage = previous.usage ? { ...previous.usage } : previous.usage
        replacement.conversationEntryCount = previous.conversationEntryCount
        replacement.autoRotatePending = previous.autoRotatePending
        const queuedMessages = previous.messageQueue ? previous.messageQueue.list() : replacement.messageQueue.list()
        const pendingDirectSendMessages = [...previous.pendingDirectSendMessages]
        const currentQueuedMessage = previous.currentQueuedMessage
        if (currentQueuedMessage) {
          if (currentQueuedMessage.priority === 'high') {
            pendingDirectSendMessages.unshift(currentQueuedMessage)
          } else {
            queuedMessages.unshift(currentQueuedMessage)
          }
        }
        replacement.currentQueuedMessage = undefined
        replacement.pendingDirectSendMessages = pendingDirectSendMessages.filter((message, index, messages) => {
          return message.priority === 'high'
            && messages.findIndex((candidate) => candidate.id === message.id) === index
        })
        replacement.messageQueue = new SessionMessageQueue(
          previous.messageQueue?.maxSize ?? replacement.messageQueue.maxSize,
          queuedMessages.filter((message, index, messages) => {
            return message.priority !== 'high'
              && messages.findIndex((candidate) => candidate.id === message.id) === index
          }),
        )
        // Transfer connected WS clients to the replacement so broadcasts
        // from the new runtime reach them without a reconnect round-trip.
        for (const client of previous.clients) {
          replacement.clients.add(client)
        }
        previous.clients.clear()
      }
      // sessionEventHandlers is keyed by `name`, so the replacement that
      // reuses the same slot naturally keeps prior subscribers attached.
      sessions.set(name, replacement)
      schedulePersistedSessionsWrite()
      if (
        replacement.kind === 'stream' &&
        !replacement.currentQueuedMessage &&
        (replacement.pendingDirectSendMessages.length > 0 || replacement.messageQueue.size > 0)
      ) {
        scheduleQueuedMessageDrain(replacement, { force: true })
      }
      return replacement
    },

    async sendToSession(name, payload, options) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return false
      }
      const { text, images, displayText, clientSendId, userEventSubtype } = normalizeSendPayload(payload)
      const recovery = getCredentialRecoveryRequest?.(name) ?? session.credentialPoolRecovery
      if (options?.queue) {
        const message = displayText !== undefined || clientSendId || userEventSubtype
          ? createQueuedMessage(text, options.priority ?? 'normal', images, displayText, clientSendId, userEventSubtype)
          : createQueuedMessage(text, options.priority ?? 'normal', images)
        const queued = enqueueQueuedMessage(session, message)
        if (!queued.ok) {
          return false
        }
        scheduleQueuedMessageDrain(session)
        return true
      }

      if (recovery) {
        const message = displayText !== undefined || clientSendId || userEventSubtype
          ? createQueuedMessage(text, 'high', images, displayText, clientSendId, userEventSubtype)
          : createQueuedMessage(text, 'high', images)
        const queued = enqueueQueuedMessage(session, message)
        if (!queued.ok) {
          return false
        }
        scheduleQueuedMessageDrain(session, { force: true })
        return true
      }

      const result = displayText !== undefined || clientSendId || userEventSubtype
        ? await sendImmediateTextToStreamSession(session, text, images, displayText, clientSendId, userEventSubtype)
        : await sendImmediateTextToStreamSession(session, text, images)
      return result.ok
    },

    recordSessionEvent(name, event) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return false
      }

      session.lastEventAt = new Date().toISOString()
      session.events.push(event)
      const handlers = sessionEventHandlers.get(name)
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event)
          } catch {
            // Session event observers must not interrupt commander routing.
          }
        }
      }
      const payload = JSON.stringify(event)
      for (const client of session.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload)
        }
      }
      schedulePersistedSessionsWrite()
      return true
    },

    deleteSession(name) {
      const session = sessions.get(name)
      if (!session) {
        return
      }

      for (const client of session.clients) {
        client.close(1000, 'Commander stopped')
      }

      if (session.kind === 'stream') {
        void teardownProviderSession(session, `Commander stopped session "${name}"`)
      } else if (session.kind === 'pty') {
        session.pty.kill()
      }
      // External sessions have no local process.

      sessions.delete(name)
      sessionEventHandlers.delete(name)
      schedulePersistedSessionsWrite()
    },

    getSession(name) {
      const session = sessions.get(name)
      return session?.kind === 'stream' ? session : undefined
    },

    getCredentialRecoveryRequest,

    clearCredentialRecoveryRequest,

    getActiveCredentialPoolId,

    subscribeToEvents(name, handler) {
      let handlers = sessionEventHandlers.get(name)
      if (!handlers) {
        handlers = new Set()
        sessionEventHandlers.set(name, handlers)
      }
      handlers.add(handler)
      return () => {
        const currentHandlers = sessionEventHandlers.get(name)
        if (!currentHandlers) {
          return
        }
        currentHandlers.delete(handler)
        if (currentHandlers.size === 0) {
          sessionEventHandlers.delete(name)
        }
      }
    },

    async shutdown() {
      await shutdownProviderRuntimes()
    },
  }
}
