import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  normalizeClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  normalizeClaudeEffortLevel,
} from '../../../claude-effort.js'
import {
  DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  normalizeClaudeMaxThinkingTokens,
} from '../../../claude-max-thinking-tokens.js'
import {
  createClaudeProviderActivityEnvelope,
  createClaudeProviderErrorEnvelope,
  createClaudeTranscriptMapper,
  createClaudeTurnEndEnvelope,
  createClaudeUserTranscriptEnvelopes,
} from '../../event-normalizers/claude.js'
import {
  buildLoginShellCommand,
  countMachineEnvSendKeys,
  prepareDaemonMachineLaunchEnvironment,
  prepareMachineLaunchEnvironment,
  buildSshArgs,
  isDaemonMachine,
  isRemoteMachine,
} from '../../machines.js'
import {
  isProviderAuthRequiredText,
  mergeProviderSpawnAuthIntoLaunch,
} from '../../provider-auth.js'
import { isApprovalBridgeProviderError } from '../../provider-errors.js'
import type { PreparedMachineLaunchEnvironment } from '../../machine-credentials.js'
import type { MachineDaemonRegistry } from '../../daemon/registry.js'
import {
  cloneActiveSkillInvocation,
  snapshotExitedStreamSession,
  toCompletedSession,
  toExitBasedCompletedSession,
} from '../../session/state.js'

function createLocalPromptResource(prompt: string): {
  directory: string
  file: string
  cleanup: () => void
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'herd-claude-prompt-'))
  const file = path.join(directory, 'prompt.md')
  try {
    writeFileSync(file, prompt, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  let cleaned = false
  return {
    directory,
    file,
    cleanup: () => {
      if (cleaned) {
        return
      }
      cleaned = true
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
import {
  createClaudeProviderContext,
  ensureClaudeProviderContext,
  readClaudeSessionId,
} from '../../providers/provider-session-context.js'
import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  SessionMessageQueue,
  type QueuedMessageImage,
} from '../../message-queue.js'
import { isHiddenInternalUserEventSubtype } from '../../user-event-subtypes.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  PromptAudit,
  StreamSessionAdapter,
  StreamJsonEvent,
  StreamSession,
  StreamSessionCreateOptions,
} from '../../types.js'
import { ownedLocalProcessGroup, ownedTransportProcessGroup } from '../../provider-process.js'
import {
  buildClaudeApprovalSettingsJson,
  buildClaudeLocalLoginShellSpawn,
  buildClaudeShellInvocation,
  buildClaudeSpawnEnv,
  buildClaudeStreamArgs,
  resolveClaudeApprovalBaseUrl,
  resolveClaudeApprovalPort,
} from './helpers.js'
import {
  createApprovalBridgeNonce,
  createApprovalBridgeToken,
  createConversationApprovalBridgeToken,
} from '../../../policies/approval-bridge-token.js'

export interface ClaudeStreamSessionDeps {
  /**
   * Resolve (creating on first use) the conversation-lifetime approval bridge
   * credential for a conversation. When present and the launch carries a
   * conversationId, the session's bridge token is conversation-scoped so
   * provider replacement never mints an incompatible approval authority.
   */
  resolveConversationApprovalBridgeCredential?(
    conversationId: string,
  ): Promise<{ credentialId: string; epoch: number } | null>
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  clearExitedSession(sessionName: string): void
  deleteLiveSession(sessionName: string): void
  getActiveSession(sessionName: string): AnySession | undefined
  resetActiveTurnState(session: StreamSession): void
  schedulePersistedSessionsWrite(): void
  setCompletedSession(sessionName: string, session: CompletedSession): void | Promise<void>
  setExitedSession(sessionName: string, session: ExitedStreamSessionState): void
  shouldPreserveSession?(session: StreamSession): boolean
  spawnImpl?: typeof spawn
  daemonRegistry?: Pick<MachineDaemonRegistry, 'attachProcess' | 'spawnProcess'>
  internalToken?: string
  approvalBridgeSigningSecret?: string
  writeToStdin(session: StreamSession, data: string): boolean
  writeTranscriptMeta(session: StreamSession): void
  markProviderAuthRequired?(
    session: StreamSession,
    detail: string,
    recovery?: {
      interruptedMessage?: StreamSession['currentQueuedMessage']
      interruptedTurnHadSideEffects?: boolean
      interruptedTurnId?: string
    },
  ): Promise<unknown> | unknown
}

function buildPromptContent(
  text: string,
  images?: QueuedMessageImage[],
): string | Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
> {
  if (!images?.length) {
    return text
  }

  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ]
}

function buildUserEvent(
  text: string,
  images?: QueuedMessageImage[],
  subtype?: string,
  displayText?: string,
  clientSendId?: string,
): StreamJsonEvent {
  return {
    type: 'user',
    ...(subtype ? { subtype } : {}),
    ...(displayText !== undefined ? { displayText: displayText.trim() } : {}),
    ...(clientSendId ? { clientSendId } : {}),
    message: { role: 'user', content: buildPromptContent(text, images) },
  } as unknown as StreamJsonEvent
}

function buildClaudeUserEvents(
  session: StreamSession,
  text: string,
  images?: QueuedMessageImage[],
  displayText?: string,
  clientSendId?: string,
): StreamJsonEvent[] {
  return createClaudeUserTranscriptEnvelopes(text, {
    sessionId: readClaudeSessionId(session),
    displayText,
    clientSendId,
    images,
  }) as StreamJsonEvent[]
}

function readStdinPreflightFailure(session: StreamSession): { retryable: boolean; reason: string } | null {
  const stdin = session.process.stdin
  if (!stdin) {
    return { retryable: false, reason: 'Stream session unavailable' }
  }
  if ('writable' in stdin && stdin.writable === false) {
    return { retryable: false, reason: 'Stream session unavailable' }
  }
  if (session.stdinDraining) {
    return { retryable: true, reason: 'Process stdin is busy' }
  }
  return null
}

const DEFAULT_CLAUDE_APPEND_PROMPT_MAX_BYTES = 96 * 1024

function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4)
}

function resolveClaudeAppendPromptMaxBytes(env: NodeJS.ProcessEnv): number {
  const raw = env.HERD_CLAUDE_APPEND_PROMPT_MAX_BYTES?.trim()
  if (!raw) {
    return DEFAULT_CLAUDE_APPEND_PROMPT_MAX_BYTES
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CLAUDE_APPEND_PROMPT_MAX_BYTES
}

function extractPromptSections(prompt: string): string[] {
  return prompt
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => /^#{1,3}\s+\S/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 80)
}

export function buildClaudePromptAudit(
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
): PromptAudit {
  const byteLength = Buffer.byteLength(prompt, 'utf8')
  const maxBytes = resolveClaudeAppendPromptMaxBytes(env)
  if (byteLength > maxBytes) {
    throw new Error(
      `Claude append prompt is ${byteLength} bytes, exceeding HERD_CLAUDE_APPEND_PROMPT_MAX_BYTES=${maxBytes}; memory contents must be discovered progressively instead of injected.`,
    )
  }
  return {
    transport: 'append-system-prompt-file',
    source: 'herd-commander-bootstrap',
    byteLength,
    tokenEstimate: estimatePromptTokens(prompt),
    maxBytes,
    sections: extractPromptSections(prompt),
  }
}

function scrubInheritedClaudeOAuth(
  prepared: PreparedMachineLaunchEnvironment,
  keepManagedOAuth: boolean,
): PreparedMachineLaunchEnvironment {
  if (keepManagedOAuth) {
    return prepared
  }
  const env: NodeJS.ProcessEnv = { ...prepared.env, CLAUDE_CODE_OAUTH_TOKEN: undefined }
  const sshSendEnvKeys = prepared.sshSendEnvKeys.filter((key) => {
    const value = env[key]
    if (typeof value === 'string' && value.startsWith('CLAUDE_CODE_OAUTH_TOKEN=')) {
      env[key] = undefined
      return false
    }
    return true
  })
  return { ...prepared, env, sshSendEnvKeys }
}

export function createClaudeSessionAdapter(
  deps: Pick<
    ClaudeStreamSessionDeps,
    'appendEvent' | 'broadcastEvent' | 'resetActiveTurnState' | 'writeToStdin'
  >,
): StreamSessionAdapter {
  return {
    async dispatchSend(session, text, mode, images, options) {
      const normalizedImages = images && images.length > 0 ? [...images] : undefined

      if (mode === 'queue') {
        const backlogCount = session.pendingDirectSendMessages.length + session.messageQueue.size
        if (backlogCount >= session.messageQueue.maxSize) {
          return { ok: false, retryable: false, reason: `Queue is full (max ${session.messageQueue.maxSize} messages)` }
        }
        const { message, position } = session.messageQueue.enqueue({
          text,
          displayText: options?.displayText,
          images: normalizedImages,
          clientSendId: options?.clientSendId,
          userEventSubtype: options?.userEventSubtype,
          priority: 'normal',
        })
        return { ok: true, delivered: 'queued', message, position }
      }

      const stdinFailure = readStdinPreflightFailure(session)
      if (stdinFailure) {
        return { ok: false, retryable: stdinFailure.retryable, reason: stdinFailure.reason }
      }

      deps.resetActiveTurnState(session)
      if (isHiddenInternalUserEventSubtype(options?.userEventSubtype)) {
        const userEvent = buildUserEvent(text, normalizedImages, options?.userEventSubtype)
        const sent = deps.writeToStdin(session, `${JSON.stringify(userEvent)}\n`)
        if (!sent) {
          if (session.stdinDraining) {
            return { ok: false, retryable: true, reason: 'Process stdin is busy' }
          }
          return { ok: false, retryable: false, reason: 'Stream session unavailable' }
        }
        return { ok: true, delivered: 'live' }
      }
      const displayEvents = buildClaudeUserEvents(
        session,
        text,
        normalizedImages,
        options?.displayText,
        options?.clientSendId,
      )
      for (const displayEvent of displayEvents) {
        deps.appendEvent(session, displayEvent)
        deps.broadcastEvent(session, displayEvent)
      }

      const userEvent = buildUserEvent(text, normalizedImages, options?.userEventSubtype)
      const sent = deps.writeToStdin(session, `${JSON.stringify(userEvent)}\n`)
      if (!sent) {
        if (session.stdinDraining) {
          return { ok: false, retryable: true, reason: 'Process stdin is busy' }
        }
        return { ok: false, retryable: false, reason: 'Stream session unavailable' }
      }
      return { ok: true, delivered: 'live' }
    },
  }
}

export function createClaudeStreamSession(
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string | undefined,
  machine: MachineConfig | undefined,
  options: StreamSessionCreateOptions = {},
  deps: ClaudeStreamSessionDeps,
): StreamSession {
  deps.clearExitedSession(sessionName)

  const initializedAt = new Date().toISOString()
  const effort = options.omitEffort
    ? undefined
    : normalizeClaudeEffortLevel(options.effort, DEFAULT_CLAUDE_EFFORT_LEVEL)
  const adaptiveThinking = normalizeClaudeAdaptiveThinkingMode(
    options.adaptiveThinking,
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const maxThinkingTokens = normalizeClaudeMaxThinkingTokens(
    options.maxThinkingTokens,
    DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  )
  const remote = isRemoteMachine(machine)
  const daemon = isDaemonMachine(machine)
  const settingsJson = buildClaudeApprovalSettingsJson()
  const appendSystemPrompt = options.systemPrompt?.trim()
  const promptAudit = appendSystemPrompt
    ? buildClaudePromptAudit(appendSystemPrompt)
    : undefined
  const localPromptResource = !remote && !daemon && appendSystemPrompt
    ? createLocalPromptResource(appendSystemPrompt)
    : undefined
  const localPromptFile = localPromptResource?.file
  const cleanupProcessResources = localPromptResource?.cleanup
  const args = buildClaudeStreamArgs(
    mode,
    options.resumeSessionId,
    localPromptFile,
    options.maxTurns,
    effort ?? null,
    settingsJson,
    options.model,
  )

  const localSpawnCwd = process.env.HOME || '/tmp'
  const requestedCwd = cwd ?? machine?.cwd
  const sessionCwd = requestedCwd ?? localSpawnCwd
  const preparedLaunch = scrubInheritedClaudeOAuth(
    mergeProviderSpawnAuthIntoLaunch(
      daemon
        ? prepareDaemonMachineLaunchEnvironment(machine)
        : prepareMachineLaunchEnvironment(machine, process.env),
      options.providerAuth,
      machine,
    ),
    Boolean(options.providerAuth?.env?.CLAUDE_CODE_OAUTH_TOKEN),
  )
  const shellManagedPrompt = localPromptFile ? undefined : appendSystemPrompt
  const remoteClaude = buildClaudeShellInvocation(args, adaptiveThinking, maxThinkingTokens, shellManagedPrompt)
  const remoteStreamCmd = buildLoginShellCommand(
    remoteClaude,
    requestedCwd,
    remote || daemon ? preparedLaunch.sourcedEnvFile : undefined,
    remote ? countMachineEnvSendKeys(preparedLaunch.sshSendEnvKeys) : 0,
  )
  const localShellSpawn = buildClaudeLocalLoginShellSpawn(
    args,
    adaptiveThinking,
    maxThinkingTokens,
    requestedCwd,
    preparedLaunch.sourcedEnvFile,
    process.env.SHELL,
    shellManagedPrompt,
    options.providerAuth?.credentialPoolMode === 'global-continuity',
  )
  // Remote Claude needs the EC2 approval daemon reachable on the remote machine
  // for every PreToolUse hook call. SSH does not propagate spawn env by default,
  // so we (a) reverse-tunnel the daemon back via `-R 127.0.0.1:<port>:127.0.0.1:<port>`
  // and (b) propagate the scoped approval token via SSH's environment channel.
  // Token may be undefined when the local server has not minted one — we still
  // open the tunnel so the hook can reach the daemon (auth fails with a clear
  // 401, not a `fetch failed`). See the upstream session-launch issue.
  // Conversation-backed sessions mint a conversation-scoped (v3) credential:
  // the token is owned by the conversation, so every launch/replacement for
  // the same conversation produces an equivalent token and old provider
  // processes keep passing approval checks after any rotation. Sessions with
  // no conversation credential keep the legacy session-scoped nonce token.
  const approvalBridgeCredential = options.approvalBridgeCredential
  const approvalBridgeNonce = approvalBridgeCredential
    ? undefined
    : options.approvalBridgeNonce?.trim() || createApprovalBridgeNonce()
  const approvalBridgeToken = deps.approvalBridgeSigningSecret
    ? approvalBridgeCredential
      ? createConversationApprovalBridgeToken({
          signingSecret: deps.approvalBridgeSigningSecret,
          conversationId: approvalBridgeCredential.conversationId,
          credentialId: approvalBridgeCredential.credentialId,
          epoch: approvalBridgeCredential.epoch,
          sessionName,
        })
      : approvalBridgeNonce
        ? createApprovalBridgeToken({
            signingSecret: deps.approvalBridgeSigningSecret,
            sessionName,
            nonce: approvalBridgeNonce,
          })
        : undefined
    : undefined
  const approvalBaseUrl = resolveClaudeApprovalBaseUrl(process.env)
  const approvalPort = resolveClaudeApprovalPort(process.env)
  const remoteApprovalBridge = remote
    ? {
        port: approvalPort,
        approvalBridgeToken,
        baseUrl: approvalBaseUrl,
      }
    : undefined
  const spawnCommand = remote ? 'ssh' : (daemon ? 'sh' : localShellSpawn.command)
  const spawnArgs = remote
    ? buildSshArgs(
      machine,
      remoteStreamCmd,
      false,
      remoteApprovalBridge,
      preparedLaunch.sshSendEnvKeys,
    )
    : daemon
      ? ['-lc', remoteStreamCmd]
    : localShellSpawn.args
  const spawnCwd = remote ? localSpawnCwd : (daemon ? requestedCwd : sessionCwd)
  const spawnImpl = deps.spawnImpl ?? spawn
  const spawnEnv = buildClaudeSpawnEnv(preparedLaunch.env, adaptiveThinking, maxThinkingTokens, {
    approvalBridgeToken,
    baseUrl: approvalBaseUrl,
    port: approvalPort,
  })
  if (!options.providerAuth?.env?.CLAUDE_CODE_OAUTH_TOKEN) {
    spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = undefined
  }
  spawnEnv.HERD_SESSION_NAME = sessionName

  const childProcess: ChildProcess = daemon
    ? (
        options.daemonProcess
          ? deps.daemonRegistry?.attachProcess(machine.id, options.daemonProcess)
          : deps.daemonRegistry?.spawnProcess(machine.id, {
              command: spawnCommand,
              args: spawnArgs,
              cwd: spawnCwd,
              env: spawnEnv,
            })
      ) ?? (() => {
        throw new Error(`Daemon machine "${machine.id}" is not connected`)
      })()
    : (() => {
        try {
          return spawnImpl(spawnCommand, spawnArgs, {
            cwd: spawnCwd,
            env: spawnEnv,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        } catch (error) {
          cleanupProcessResources?.()
          throw error
        }
      })()

  const session: StreamSession = {
    kind: 'stream',
    name: sessionName,
    sessionType: options.sessionType ?? 'worker',
    creator: options.creator ?? { kind: 'human' },
    conversationId: options.conversationId,
    agentType: 'claude',
    effort,
    adaptiveThinking,
    maxThinkingTokens,
    mode,
    cwd: sessionCwd,
    host: remote || daemon ? machine.id : undefined,
    currentSkillInvocation: cloneActiveSkillInvocation(options.currentSkillInvocation),
    spawnedBy: options.spawnedBy,
    spawnedWorkers: options.spawnedWorkers ? [...options.spawnedWorkers] : [],
    task: task.length > 0 ? task : undefined,
    process: childProcess,
    processTree: daemon
      ? { ownership: 'daemon-process-group' }
      : remote
        ? ownedTransportProcessGroup(childProcess)
        : ownedLocalProcessGroup(childProcess),
    cleanupProcessResources,
    events: [],
    clients: new Set(),
    createdAt: options.createdAt ?? initializedAt,
    lastEventAt: initializedAt,
    systemPrompt: options.systemPrompt,
    promptAudit,
    maxTurns: options.maxTurns,
    model: options.model,
    approvalBridgeNonce,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: task.length === 0,
    conversationEntryCount: 0,
    autoRotatePending: false,
    codexPendingApprovals: new Map(),
    codexUnclassifiedIncomingCount: 0,
    messageQueue: new SessionMessageQueue(DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT),
    queuedMessageRetryDelayMs: 250,
    pendingDirectSendMessages: [],
    queuedMessageDrainScheduled: false,
    queuedMessageDrainPending: false,
    queuedMessageDrainPendingForce: false,
    providerContext: createClaudeProviderContext({
      sessionId: options.resumeSessionId,
      effort,
      ...(options.omitEffort ? { omitEffort: true } : {}),
      adaptiveThinking,
      maxThinkingTokens,
    }),
    providerAuthSnapshot: options.providerAuth?.snapshot,
    credentialPoolId: options.providerAuth?.credentialPoolId,
    credentialPoolMode: options.providerAuth?.credentialPoolMode,
    activeTurnId: undefined,
    adapter: createClaudeSessionAdapter(deps),
    resumedFrom: options.resumedFrom,
    restoredIdle: Boolean(options.resumeSessionId) && task.length === 0,
  }

  deps.writeTranscriptMeta(session)
  const transcriptMapper = createClaudeTranscriptMapper()

  if (typeof childProcess.stdin?.on === 'function') {
    childProcess.stdin.on('error', () => {
      // Session cleanup is handled by the process exit/error listeners.
    })
  }

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    session.stdoutBuffer += chunk.toString()
    const lines = session.stdoutBuffer.split('\n')
    session.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as StreamJsonEvent
        const envelopes = transcriptMapper.map(event)
        if (envelopes.length === 0) {
          continue
        }
        for (const envelope of envelopes) {
          deps.appendEvent(session, envelope)
          deps.broadcastEvent(session, envelope)
        }
      } catch {
        // Skip unparseable lines from the CLI.
      }
    }
  })

  // Drain any remaining buffered NDJSON when stdout closes. NDJSON lines
  // should end in '\n', but if the CLI exits without flushing a trailing
  // newline the last event (e.g. a `result`) stays in `stdoutBuffer` and
  // the 'data' handler never parses it. Without this drain, the 'exit'
  // listener runs with `finalResultEvent` unset — so one-shot session
  // types fall into the synthetic-completion fallback even though a real
  // `result` was emitted. See issue #1217 / PR #462 fix #4.
  function drainTrailingStdoutBuffer(): void {
    const remaining = session.stdoutBuffer.trim()
    session.stdoutBuffer = ''
    if (!remaining) {
      return
    }
    try {
      const event = JSON.parse(remaining) as StreamJsonEvent
      const envelopes = transcriptMapper.map(event)
      if (envelopes.length === 0) {
        return
      }
      for (const envelope of envelopes) {
        deps.appendEvent(session, envelope)
        deps.broadcastEvent(session, envelope)
      }
    } catch {
      // Ignore unparseable trailing data — same policy as the 'data' handler.
    }
  }

  // One-shot completion is deferred until BOTH the child process has exited
  // AND its stdout has finished draining. In Node, `'exit'` may fire while
  // stdout is still open, so a final `result` line that lacks a trailing
  // `\n` is still sitting in `stdoutBuffer` when the exit handler runs. If
  // we finalized completion right there, sentinel/cron sessions would land
  // in `completedSessions` with the synthetic exit-only payload and the
  // real `result` (parsed later by the stdout `'end'` drain) would never
  // update polling clients. Tracking the two halves separately and only
  // committing once both have settled closes that race. See issue #1217
  // P1 review on PR #1244.
  type ExitCompletionEvent = StreamJsonEvent & {
    exitCode?: number
    signal?: string | number
    text?: string
  }
  let processExited = false
  let stdoutEnded = false
  let completionFinalized = false
  let finalizationContext:
    | { kind: 'exit'; exitEvent: ExitCompletionEvent }
    | { kind: 'error'; errorEvent: ExitCompletionEvent }
    | null = null
  let clientsClosed = false

  function closeSessionClients(): void {
    if (clientsClosed) return
    clientsClosed = true
    for (const client of session.clients) {
      client.close(1000, 'Session ended')
    }
  }

  async function finalizeCompletionIfReady(): Promise<void> {
    if (completionFinalized) return
    if (!processExited || !stdoutEnded) return
    if (!finalizationContext) return
    completionFinalized = true

    if (deps.getActiveSession(sessionName) !== session) {
      return
    }

    if (session.finalResultEvent) {
      await deps.setCompletedSession(
        sessionName,
        toCompletedSession(
          sessionName,
          session.completedTurnAt ?? new Date().toISOString(),
          session.finalResultEvent,
          session.usage.costUsd,
          {
            sessionType: session.sessionType,
            creator: session.creator,
            spawnedBy: session.spawnedBy,
            createdAt: session.createdAt,
          },
        ),
      )
    } else if (
      session.sessionType === 'cron' ||
      session.sessionType === 'sentinel' ||
      session.sessionType === 'automation'
    ) {
      // One-shot session types (`cron`, `sentinel`, `automation`) must always land in
      // `completedSessions` so the executor's GET poll resolves to
      // `completed: true` rather than the `exitedStreamSessions` 'exited'
      // branch (which the polling client maps to 'running' via completedFlag
      // === false). Keeps the 30-status-check fallback from firing on fast
      // exits without `result` (e.g. 429, auth, crash). See issue #1217 / PR #462.
      const fallbackEvent =
        finalizationContext.kind === 'exit'
          ? finalizationContext.exitEvent
          : finalizationContext.errorEvent
      await deps.setCompletedSession(
        sessionName,
        toExitBasedCompletedSession(sessionName, fallbackEvent, session.usage.costUsd, {
          sessionType: session.sessionType,
          creator: session.creator,
          spawnedBy: session.spawnedBy,
          createdAt: session.createdAt,
        }),
      )
    }

    if (deps.shouldPreserveSession?.(session)) {
      deps.schedulePersistedSessionsWrite()
      return
    }
    closeSessionClients()
    deps.setExitedSession(sessionName, snapshotExitedStreamSession(session))
    deps.deleteLiveSession(sessionName)

    if (finalizationContext.kind === 'error') {
      deps.schedulePersistedSessionsWrite()
    } else {
      const isIdleRestoreExit =
        session.restoredIdle &&
        session.lastTurnCompleted &&
        ensureClaudeProviderContext(session).sessionId !== undefined
      if (!isIdleRestoreExit) {
        deps.schedulePersistedSessionsWrite()
      }
    }
  }

  childProcess.stdout?.on('end', () => {
    drainTrailingStdoutBuffer()
    stdoutEnded = true
    void finalizeCompletionIfReady()
  })

  childProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (!text) return
    const lines = text
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : undefined
    if (lastLine) {
      session.lastStderrSummary = lastLine.length > 300
        ? `${lastLine.slice(0, 297)}...`
        : lastLine
    }
    const stderrEvent = createClaudeProviderActivityEnvelope(
      'Claude stderr',
      { detail: `stderr: ${text}`, text },
      readClaudeSessionId(session),
    ) as StreamJsonEvent
    deps.appendEvent(session, stderrEvent)
    deps.broadcastEvent(session, stderrEvent)
    if (isApprovalBridgeProviderError(text)) {
      const bridgeErrorEvent = createClaudeProviderErrorEnvelope(
        text,
        { detail: `stderr: ${text}`, text },
        readClaudeSessionId(session),
        'approval_bridge',
        'The approval bridge is stale or pointed at the wrong API base. Recover or relaunch this runtime session.',
      ) as StreamJsonEvent
      deps.appendEvent(session, bridgeErrorEvent)
      deps.broadcastEvent(session, bridgeErrorEvent)
      return
    }
    if (isProviderAuthRequiredText(text)) {
      const interruptedMessage = session.activeTurnMessage ?? session.currentQueuedMessage
      const authErrorEvent = createClaudeProviderErrorEnvelope(
        text,
        { detail: `stderr: ${text}`, text },
        readClaudeSessionId(session),
        'auth_required',
      ) as StreamJsonEvent
      deps.appendEvent(session, authErrorEvent)
      deps.broadcastEvent(session, authErrorEvent)
      void deps.markProviderAuthRequired?.(session, text, {
        ...(interruptedMessage ? { interruptedMessage } : {}),
        interruptedTurnHadSideEffects: true,
        ...(interruptedMessage ? { interruptedTurnId: interruptedMessage.id } : {}),
      })
    }
  })

  const cpEmitter = childProcess as unknown as NodeJS.EventEmitter
  cpEmitter.on('exit', (code: number | null, signal: string | null) => {
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }
    if (completionFinalized || finalizationContext?.kind === 'error') {
      return
    }

    if (!session.lastTurnCompleted) {
      ensureClaudeProviderContext(session).sessionId = undefined
    }

    const exitCode = code ?? -1
    const stderrSummary = session.lastStderrSummary
    const signalText = signal ?? undefined
    const baseText = signalText
      ? `Process exited (signal: ${signalText})`
      : `Process exited with code ${exitCode}`
    const exitEvent: ExitCompletionEvent = {
      type: 'exit',
      exitCode,
      signal: signalText,
      stderr: stderrSummary,
      text: stderrSummary ? `${baseText}; stderr: ${stderrSummary}` : baseText,
    }
    const exitEnvelope = createClaudeProviderActivityEnvelope(
      'Claude process exited',
      {
        lifecycleBoundary: 'runtime.end',
        exitCode,
        signal: signalText,
        stderr: stderrSummary,
        detail: exitEvent.text,
      },
      readClaudeSessionId(session),
    ) as StreamJsonEvent
    deps.appendEvent(session, exitEnvelope)
    deps.broadcastEvent(session, exitEnvelope)

    finalizationContext = { kind: 'exit', exitEvent }
    processExited = true
    void finalizeCompletionIfReady()
  })

  // 'close' is guaranteed to fire AFTER 'exit' (or 'error' on spawn failure)
  // and after the stdio streams have closed. We use it as a backstop so the
  // synthetic-vs-real completion decision still runs even if stdout never
  // emits its own 'end' event (rare but possible when the stream is
  // destroyed without an EOF). Calling drainTrailingStdoutBuffer() here is
  // idempotent — if the stdout 'end' handler already drained, the buffer
  // is empty and this is a no-op.
  cpEmitter.on('close', () => {
    cleanupProcessResources?.()
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }
    if (!stdoutEnded) {
      drainTrailingStdoutBuffer()
      stdoutEnded = true
    }
    void finalizeCompletionIfReady()
  })

  cpEmitter.on('error', (error: Error) => {
    cleanupProcessResources?.()
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }

    const detail = `Process error: ${error.message}`
    const errorEvent: ExitCompletionEvent = {
      type: 'exit',
      exitCode: -1,
      text: detail,
    }
    const errorEnvelope = createClaudeTurnEndEnvelope(
      'failed',
      detail,
      readClaudeSessionId(session),
    ) as StreamJsonEvent
    deps.appendEvent(session, errorEnvelope)
    deps.broadcastEvent(session, errorEnvelope)

    if (!finalizationContext) {
      finalizationContext = { kind: 'error', errorEvent }
    }
    processExited = true
    // Errors imply the process is in trouble (often spawn failure with no
    // stdio to drain). Don't wait for stdout 'end' or 'close' — those may
    // be delayed or skipped on some platforms — and instead finalize now
    // so we don't leak a zombie live session. Drain the trailing buffer
    // first in case a real `result` snuck in before the failure: the
    // race-fix payoff is preserving real results, not deferring forever.
    if (!stdoutEnded) {
      drainTrailingStdoutBuffer()
      stdoutEnded = true
    }
    void finalizeCompletionIfReady()
  })

  if (task.length > 0) {
    for (const userEvent of buildClaudeUserEvents(session, task)) {
      deps.appendEvent(session, userEvent)
      deps.broadcastEvent(session, userEvent)
    }
    const userMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: task } })
    deps.writeToStdin(session, userMsg + '\n')
  }

  return session
}
