import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import type { MachineConfig, CommanderSessionsInterface } from '../agents/types.js'
import {
  createWorkspaceSshCommandRunner,
  isRemoteMachine,
  LOCAL_MACHINE_ID,
} from '../agents/machines.js'
import type { ConversationStore } from '../commanders/conversation-store.js'
import type { CommanderSessionStore } from '../commanders/store.js'
import { buildConversationSessionName } from '../commanders/routes/conversation-runtime.js'
import {
  resolveWorkspaceRoot,
  WorkspaceError,
} from './resolver.js'
import type { WorkspaceCommandRunner } from './git.js'
import type {
  ResolvedWorkspaceTarget,
  WorkspaceMachineDescriptor,
  WorkspaceTargetDescriptor,
} from './types.js'
import { WorkspaceTargetStore } from './store.js'

export interface WorkspaceMachineDescriptorCapability {
  readMachineRegistry(): Promise<MachineConfig[]>
}

export interface WorkspaceResolverCapability {
  open(input: {
    conversationId?: string | null
    sessionName?: string | null
    commanderId?: string | null
    authorizationConversationId?: string | null
    authorizationSessionName?: string | null
    authorizationCommanderId?: string | null
    hostHint?: string | null
    pathHint?: string | null
  }): Promise<WorkspaceTargetDescriptor>
  resolveTarget(targetId: string): Promise<ResolvedWorkspaceTarget>
}

export interface AuthorizedHostEntry {
  host: string
  rootPathPrefix: string
  machine?: WorkspaceMachineDescriptor
}

function machineToDescriptor(machine: MachineConfig & { host: string }): WorkspaceMachineDescriptor {
  return {
    id: machine.id,
    label: machine.label,
    host: machine.host,
    ...(machine.user ? { user: machine.user } : {}),
    ...(machine.port ? { port: machine.port } : {}),
  }
}

function normalizeHost(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || LOCAL_MACHINE_ID
}

function normalizeRootPrefix(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || '/'
}

function isPathWithinPrefix(candidatePath: string, prefix: string): boolean {
  const normalizedPrefix = normalizeRootPrefix(prefix)
  const pathApi = path.posix.isAbsolute(candidatePath) ? path.posix : path
  const relative = pathApi.relative(normalizedPrefix, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))
}

function sameHost(left: string, right: string): boolean {
  return normalizeHost(left) === normalizeHost(right)
}

function createTargetId(): string {
  return `wt-${randomUUID()}`
}

export class AuthorizedHostRegistry {
  constructor(
    private readonly machines: WorkspaceMachineDescriptorCapability,
    private readonly conversations: ConversationStore,
    private readonly sessionsInterface?: CommanderSessionsInterface,
  ) {}

  async allowed(conversationId?: string | null): Promise<AuthorizedHostEntry[]> {
    const machines = await this.machines.readMachineRegistry()
    const entries: AuthorizedHostEntry[] = machines.map((machine) => ({
      host: machine.id,
      rootPathPrefix: normalizeRootPrefix(machine.cwd),
      ...(isRemoteMachine(machine) ? { machine: machineToDescriptor(machine) } : {}),
    }))

    const normalizedConversationId = typeof conversationId === 'string'
      ? conversationId.trim()
      : ''
    if (normalizedConversationId) {
      const conversation = await this.conversations.get(normalizedConversationId)
      if (!conversation) {
        return entries
      }
      const liveSession = this.sessionsInterface?.getSession(buildConversationSessionName(conversation))
      if (liveSession) {
        const host = normalizeHost(liveSession.host)
        const remoteMachine = machines.find(
          (machine): machine is MachineConfig & { host: string } => machine.id === host && isRemoteMachine(machine),
        )
        entries.push({
          host,
          rootPathPrefix: normalizeRootPrefix(liveSession.cwd),
          ...(remoteMachine ? { machine: machineToDescriptor(remoteMachine) } : {}),
        })
      }
    }

    return entries
  }

  async authorize(
    conversationId: string | null | undefined,
    host: string,
    rootPath: string,
  ): Promise<AuthorizedHostEntry> {
    const allowed = await this.allowed(conversationId)
    const match = allowed.find((entry) => (
      sameHost(entry.host, host) && isPathWithinPrefix(rootPath, entry.rootPathPrefix)
    ))
    if (!match) {
      throw new WorkspaceError(403, 'Workspace host is not authorized for this conversation')
    }
    return match
  }
}

export interface WorkspaceResolverOptions {
  targetStore?: WorkspaceTargetStore
  machineDescriptor: WorkspaceMachineDescriptorCapability
  conversationStore: ConversationStore
  commanderStore: CommanderSessionStore
  sessionsInterface?: CommanderSessionsInterface
}

export class WorkspaceResolver implements WorkspaceResolverCapability {
  private readonly targetStore: WorkspaceTargetStore
  private readonly hostRegistry: AuthorizedHostRegistry

  constructor(private readonly options: WorkspaceResolverOptions) {
    this.targetStore = options.targetStore ?? new WorkspaceTargetStore()
    this.hostRegistry = new AuthorizedHostRegistry(
      options.machineDescriptor,
      options.conversationStore,
      options.sessionsInterface,
    )
  }

  async open(input: {
    conversationId?: string | null
    sessionName?: string | null
    commanderId?: string | null
    authorizationConversationId?: string | null
    authorizationSessionName?: string | null
    authorizationCommanderId?: string | null
    hostHint?: string | null
    pathHint?: string | null
  }): Promise<WorkspaceTargetDescriptor> {
    const sourceKey = this.resolveSourceKey(input)
    const sourceContext = this.resolveSourceContext(input)
    const authorizationConversationId = this.resolveAuthorizationConversationId(input)

    const existing = await this.targetStore.getByKey(sourceKey)
    if (existing && !input.hostHint && !input.pathHint) {
      return existing
    }

    const fallback = await this.resolveFallbackTarget(input)
    const host = normalizeHost(input.hostHint ?? fallback.host)
    const rootPath = this.resolveOpenRootPath(input.pathHint, fallback.rootPath)
    const authorized = await this.hostRegistry.authorize(authorizationConversationId || null, host, rootPath)
    const target: WorkspaceTargetDescriptor = {
      targetId: existing?.targetId ?? createTargetId(),
      ...(sourceContext.conversationId ? { conversationId: sourceContext.conversationId } : {}),
      ...(sourceContext.sessionName ? { sessionName: sourceContext.sessionName } : {}),
      ...(sourceContext.commanderId ? { commanderId: sourceContext.commanderId } : {}),
      label: `${host}:${rootPath}`,
      host,
      rootPath,
      readOnly: false,
      ...(authorized.machine ? { machine: authorized.machine } : {}),
    }

    return this.targetStore.saveForKey(sourceKey, target)
  }

  async resolveTarget(targetId: string): Promise<ResolvedWorkspaceTarget> {
    const normalizedTargetId = targetId.trim()
    if (!normalizedTargetId) {
      throw new WorkspaceError(400, 'targetId query parameter is required')
    }
    const target = await this.targetStore.getByTargetId(normalizedTargetId)
    if (!target) {
      throw new WorkspaceError(404, 'Workspace target not found')
    }

    const runner = target.machine ? createWorkspaceSshCommandRunner({
      id: target.machine.id,
      label: target.machine.label,
      host: target.machine.host,
      user: target.machine.user,
      port: target.machine.port,
    }) : undefined
    const workspace = await resolveWorkspaceRoot({
      rootPath: target.rootPath,
      source: {
        kind: 'target',
        id: target.targetId,
        label: target.label,
        host: target.host === LOCAL_MACHINE_ID ? undefined : target.host,
        readOnly: target.readOnly,
      },
      machine: target.machine,
    }, runner)

    return {
      target,
      workspace,
      ...(runner ? { commandRunner: runner } : {}),
      host: target.host,
      rootPath: workspace.rootPath,
      ...(target.machine ? { machine: target.machine } : {}),
      readOnly: workspace.readOnly,
    }
  }

  private resolveSourceKey(input: {
    conversationId?: string | null
    sessionName?: string | null
    commanderId?: string | null
    hostHint?: string | null
    pathHint?: string | null
  }): string {
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId.trim() : ''
    if (conversationId) {
      return `conversation:${conversationId}`
    }
    const sessionName = typeof input.sessionName === 'string' ? input.sessionName.trim() : ''
    if (sessionName) {
      return `session:${sessionName}`
    }
    const commanderId = typeof input.commanderId === 'string' ? input.commanderId.trim() : ''
    if (commanderId) {
      return `commander:${commanderId}`
    }
    const hostHint = typeof input.hostHint === 'string' ? input.hostHint.trim() : ''
    const pathHint = typeof input.pathHint === 'string' ? input.pathHint.trim() : ''
    if (hostHint || pathHint) {
      return `location:${normalizeHost(hostHint)}:${pathHint || '.'}`
    }
    throw new WorkspaceError(400, 'conversationId, sessionName, commanderId, or workspace location is required')
  }

  private resolveSourceContext(input: {
    conversationId?: string | null
    sessionName?: string | null
    commanderId?: string | null
  }): {
    conversationId: string
    sessionName: string
    commanderId: string
  } {
    return {
      conversationId: typeof input.conversationId === 'string' ? input.conversationId.trim() : '',
      sessionName: typeof input.sessionName === 'string' ? input.sessionName.trim() : '',
      commanderId: typeof input.commanderId === 'string' ? input.commanderId.trim() : '',
    }
  }

  private resolveAuthorizationConversationId(input: {
    conversationId?: string | null
    sessionName?: string | null
    authorizationConversationId?: string | null
    authorizationSessionName?: string | null
    authorizationCommanderId?: string | null
  }): string {
    const explicitConversationId = typeof input.authorizationConversationId === 'string'
      ? input.authorizationConversationId.trim()
      : ''
    if (explicitConversationId) {
      return explicitConversationId
    }

    const sourceConversationId = typeof input.conversationId === 'string'
      ? input.conversationId.trim()
      : ''
    if (sourceConversationId) {
      return sourceConversationId
    }

    const authorizationSessionName = typeof input.authorizationSessionName === 'string'
      ? input.authorizationSessionName.trim()
      : ''
    const sourceSessionName = typeof input.sessionName === 'string'
      ? input.sessionName.trim()
      : ''
    const sessionName = authorizationSessionName || sourceSessionName
    if (sessionName) {
      return this.options.sessionsInterface?.getSession(sessionName)?.conversationId?.trim() ?? ''
    }

    return ''
  }

  private async resolveFallbackTarget(input: {
    conversationId?: string | null
    sessionName?: string | null
    commanderId?: string | null
    hostHint?: string | null
    pathHint?: string | null
  }): Promise<{ host: string; rootPath: string }> {
    const sessionName = typeof input.sessionName === 'string' ? input.sessionName.trim() : ''
    if (sessionName) {
      const liveSession = this.options.sessionsInterface?.getSession(sessionName)
      if (!liveSession?.cwd) {
        throw new WorkspaceError(404, `Session "${sessionName}" has no workspace`)
      }
      return {
        host: normalizeHost(liveSession.host),
        rootPath: liveSession.cwd,
      }
    }

    const directCommanderId = typeof input.commanderId === 'string' ? input.commanderId.trim() : ''
    if (directCommanderId) {
      const commander = await this.options.commanderStore.get(directCommanderId)
      if (!commander?.cwd) {
        throw new WorkspaceError(404, `Commander "${directCommanderId}" has no workspace`)
      }
      return {
        host: normalizeHost(commander.remoteOrigin?.machineId),
        rootPath: commander.cwd,
      }
    }

    const hostHint = typeof input.hostHint === 'string' ? input.hostHint.trim() : ''
    const pathHint = typeof input.pathHint === 'string' ? input.pathHint.trim() : ''
    if (hostHint || pathHint) {
      const host = normalizeHost(hostHint)
      const machines = await this.options.machineDescriptor.readMachineRegistry()
      const machine = machines.find((entry) => entry.id === host)
      return {
        host,
        rootPath: normalizeRootPrefix(machine?.cwd) || homedir(),
      }
    }

    const conversationId = typeof input.conversationId === 'string'
      ? input.conversationId.trim()
      : ''
    if (!conversationId) {
      throw new WorkspaceError(400, 'conversationId, sessionName, commanderId, or workspace location is required')
    }
    const conversation = await this.options.conversationStore.get(conversationId)
    if (!conversation) {
      throw new WorkspaceError(404, `Conversation "${conversationId}" not found`)
    }

    const liveSession = this.options.sessionsInterface?.getSession(buildConversationSessionName(conversation))
    if (liveSession?.cwd) {
      return {
        host: normalizeHost(liveSession.host),
        rootPath: liveSession.cwd,
      }
    }

    const commander = await this.options.commanderStore.get(conversation.commanderId)
    if (commander?.cwd) {
      return {
        host: normalizeHost(commander.remoteOrigin?.machineId),
        rootPath: commander.cwd,
      }
    }

    return {
      host: LOCAL_MACHINE_ID,
      rootPath: homedir(),
    }
  }

  private resolveOpenRootPath(pathHint: string | null | undefined, fallbackRootPath: string): string {
    const hint = typeof pathHint === 'string' ? pathHint.trim() : ''
    if (!hint) {
      return fallbackRootPath
    }
    if (path.isAbsolute(hint) || path.posix.isAbsolute(hint)) {
      return hint
    }
    return path.resolve(fallbackRootPath, hint)
  }
}
