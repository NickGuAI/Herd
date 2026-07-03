import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  getClaudeDisableAdaptiveThinkingEnvValue,
} from '../../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
} from '../../../claude-effort.js'
import {
  DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
} from '../../../claude-max-thinking-tokens.js'
import { isTranscriptEnvelope } from '../../../../src/types/transcript-envelope.js'
import { registerProvider } from '../../providers/registry-core.js'
import {
  asClaudeProviderContext,
  createClaudeProviderContext,
  ensureClaudeProviderContext,
} from '../../providers/provider-session-context.js'
import type {
  ProviderAdapter,
  ProviderAdapterDeps,
  ProviderCreateOptions,
} from '../../providers/provider-adapter.js'
import type {
  ExitedStreamSessionState,
  PersistedStreamSession,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'
import { getDaemonProcessMetadata } from '../../daemon/registry.js'
import { claudeMachineProvider } from './machine-adapter.js'
import { claudeApprovalAdapter } from './approval-adapter.js'
import { availableModels } from './models.js'
import { createClaudeSessionAdapter, createClaudeStreamSession } from './session.js'

function extractClaudeSessionId(event: StreamJsonEvent | undefined): string | undefined {
  if (!event) {
    return undefined
  }
  if (isTranscriptEnvelope(event)) {
    const sessionId = event.source.sessionId
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      return sessionId.trim()
    }
  }
  const direct = typeof (event as Record<string, unknown>).session_id === 'string'
    ? (event as Record<string, unknown>).session_id as string
    : undefined
  if (direct?.trim()) {
    return direct.trim()
  }
  const camel = typeof (event as Record<string, unknown>).sessionId === 'string'
    ? (event as Record<string, unknown>).sessionId as string
    : undefined
  if (camel?.trim()) {
    return camel.trim()
  }
  return undefined
}

function snapshotClaudeSession(session: StreamSession): PersistedStreamSession | null {
  const context = asClaudeProviderContext(session.providerContext)
  const daemonProcess = getDaemonProcessMetadata(session.process)
  const sessionId = session.lastTurnCompleted ? context?.sessionId : undefined
  if (!sessionId && !daemonProcess) {
    return null
  }

  return {
    name: session.name,
    sessionType: session.sessionType,
    creator: session.creator,
    conversationId: session.conversationId,
    agentType: session.agentType,
    model: session.model,
    effort: context?.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
    adaptiveThinking: context?.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
    maxThinkingTokens: context?.maxThinkingTokens ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: session.currentSkillInvocation
      ? { ...session.currentSkillInvocation }
      : undefined,
    createdAt: session.createdAt,
    providerContext: createClaudeProviderContext({
      ...(sessionId ? { sessionId } : {}),
      effort: context?.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
      adaptiveThinking: context?.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
      maxThinkingTokens: context?.maxThinkingTokens ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
    }),
    credentialPoolId: session.credentialPoolId,
    credentialPoolRecovery: session.credentialPoolRecovery,
    approvalBridgeNonce: session.approvalBridgeNonce,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    resumedFrom: session.resumedFrom,
    sessionState: 'active',
    hadResult: Boolean(session.finalResultEvent),
    daemonProcess,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

function snapshotExitedClaudeSession(session: StreamSession): ExitedStreamSessionState {
  const context = ensureClaudeProviderContext(session)
  return {
    phase: 'exited',
    hadResult: Boolean(session.finalResultEvent),
    sessionType: session.sessionType,
    creator: session.creator,
    conversationId: session.conversationId,
    agentType: session.agentType,
    model: session.model,
    effort: context.effort,
    adaptiveThinking: context.adaptiveThinking,
    maxThinkingTokens: context.maxThinkingTokens,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: session.currentSkillInvocation
      ? { ...session.currentSkillInvocation }
      : undefined,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    createdAt: session.createdAt,
    providerContext: createClaudeProviderContext({
      sessionId: context.sessionId,
      effort: context.effort,
      adaptiveThinking: context.adaptiveThinking,
      maxThinkingTokens: context.maxThinkingTokens,
    }),
    credentialPoolId: session.credentialPoolId,
    credentialPoolRecovery: session.credentialPoolRecovery,
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

export const claudeProvider: ProviderAdapter = registerProvider({
  id: 'claude',
  label: 'Claude',
  eventProvider: 'claude',
  approvalAdapter: claudeApprovalAdapter,
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
    supportsMessageImages: true,
  },
  availableModels,
  defaults: {
    effort: DEFAULT_CLAUDE_EFFORT_LEVEL,
    adaptiveThinking: DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
    maxThinkingTokens: DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  },
  machineAuth: claudeMachineProvider,
  uiCapabilities: {
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    supportsMaxThinkingTokens: true,
    supportsSkills: true,
    supportsLoginMode: true,
    permissionModes: [
      { value: 'default', label: 'default', description: 'claude' },
    ],
  },
  skillScanPaths: ['~/.claude/skills', '~/.openclaw/skills'],
  buildStreamSessionAdapter(deps: ProviderAdapterDeps) {
    return createClaudeSessionAdapter(deps)
  },
  preparePtyEnv() {
    return {
      CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: getClaudeDisableAdaptiveThinkingEnvValue(
        DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
      ),
      MAX_THINKING_TOKENS: String(DEFAULT_CLAUDE_MAX_THINKING_TOKENS),
    }
  },
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps) {
    return createClaudeStreamSession(
      options.sessionName,
      options.mode,
      options.task,
      options.cwd,
      options.machine,
      {
        resumeSessionId: options.resumeSessionId,
        systemPrompt: options.systemPrompt,
        maxTurns: options.maxTurns,
        model: options.model,
        effort: options.effort,
        adaptiveThinking: options.adaptiveThinking,
        maxThinkingTokens: options.maxThinkingTokens,
        createdAt: options.createdAt,
        spawnedBy: options.spawnedBy,
        spawnedWorkers: options.spawnedWorkers,
        resumedFrom: options.resumedFrom,
        sessionType: options.sessionType,
        creator: options.creator,
        conversationId: options.conversationId,
        currentSkillInvocation: options.currentSkillInvocation,
        approvalBridgeNonce: options.approvalBridgeNonce,
        daemonProcess: options.daemonProcess,
        providerAuth: options.providerAuth,
      },
      deps,
    )
  },
  restore(entry, machine, deps, providerAuth) {
    const context = asClaudeProviderContext(entry.providerContext)
    return this.create({
      sessionName: entry.name,
      mode: entry.mode,
      task: '',
      cwd: entry.cwd,
      machine,
      resumeSessionId: context?.sessionId,
      createdAt: entry.createdAt,
      model: entry.model,
      spawnedBy: entry.spawnedBy,
      spawnedWorkers: entry.spawnedWorkers,
      resumedFrom: entry.resumedFrom,
      sessionType: entry.sessionType,
      creator: entry.creator,
      conversationId: entry.conversationId,
      currentSkillInvocation: entry.currentSkillInvocation,
      approvalBridgeNonce: entry.approvalBridgeNonce,
      effort: context?.effort,
      adaptiveThinking: context?.adaptiveThinking,
      maxThinkingTokens: context?.maxThinkingTokens,
      daemonProcess: entry.daemonProcess,
      providerAuth,
    }, deps)
  },
  snapshotForPersist(session) {
    return snapshotClaudeSession(session)
  },
  snapshotExited(session) {
    return snapshotExitedClaudeSession(session)
  },
  hasResumeIdentifier(entry) {
    return Boolean(asClaudeProviderContext(entry.providerContext)?.sessionId)
  },
  canResumeLiveSession() {
    return false
  },
  getResumeId(session, event) {
    const context = asClaudeProviderContext(session.providerContext)
    return context?.sessionId ?? extractClaudeSessionId(event) ?? session.name
  },
  transcriptId(session, event) {
    return this.getResumeId(session, event)
  },
  teardown(session) {
    try {
      session.process.kill('SIGTERM')
    } catch {
      // Best effort only.
    }
  },
})
