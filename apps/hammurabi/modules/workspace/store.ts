import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveModuleDataDir } from '../data-dir.js'
import type {
  WorkspaceMachineDescriptor,
  WorkspacePanelDefault,
  WorkspacePreferences,
  WorkspaceTargetDescriptor,
} from './types.js'

const PANEL_DEFAULTS = new Set<WorkspacePanelDefault>(['open', 'closed', 'last-used'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMachine(value: unknown): WorkspaceMachineDescriptor | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  const host = typeof value.host === 'string' ? value.host.trim() : ''
  if (!id || !label || !host) {
    return undefined
  }
  const user = typeof value.user === 'string' && value.user.trim()
    ? value.user.trim()
    : undefined
  const port = typeof value.port === 'number' && Number.isFinite(value.port)
    ? value.port
    : undefined
  return {
    id,
    label,
    host,
    ...(user ? { user } : {}),
    ...(port ? { port } : {}),
  }
}

function parseTarget(value: unknown): WorkspaceTargetDescriptor | null {
  if (!isRecord(value)) {
    return null
  }
  const targetId = typeof value.targetId === 'string' ? value.targetId.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  const host = typeof value.host === 'string' ? value.host.trim() : ''
  const rootPath = typeof value.rootPath === 'string' ? value.rootPath.trim() : ''
  if (!targetId || !label || !host || !rootPath) {
    return null
  }
  const machine = parseMachine(value.machine)
  return {
    targetId,
    ...(typeof value.conversationId === 'string' && value.conversationId.trim()
      ? { conversationId: value.conversationId.trim() }
      : {}),
    label,
    host,
    rootPath,
    readOnly: value.readOnly === true,
    ...(machine ? { machine } : {}),
  }
}

function keyConversationId(key: string): string | undefined {
  return key.startsWith('conversation:') ? key.slice('conversation:'.length) : undefined
}

function parseTargets(raw: unknown): Record<string, WorkspaceTargetDescriptor> {
  if (!isRecord(raw)) {
    return {}
  }
  const source = isRecord(raw.targets)
    ? raw.targets
    : isRecord(raw.conversations)
      ? raw.conversations
      : raw
  const targets: Record<string, WorkspaceTargetDescriptor> = {}
  for (const [key, value] of Object.entries(source)) {
    const parsed = parseTarget(value)
    if (parsed) {
      const conversationId = parsed.conversationId ?? keyConversationId(key)
      targets[key] = {
        ...parsed,
        ...(conversationId ? { conversationId } : {}),
      }
    }
  }
  return targets
}

function parsePreferences(raw: unknown): WorkspacePreferences {
  const panelDefault = isRecord(raw) && PANEL_DEFAULTS.has(raw.panelDefault as WorkspacePanelDefault)
    ? raw.panelDefault as WorkspacePanelDefault
    : 'last-used'
  return { panelDefault }
}

export function defaultWorkspaceDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveModuleDataDir('workspace', env)
}

export class WorkspaceTargetStore {
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly filePath: string

  constructor(filePath = path.join(defaultWorkspaceDataDir(), 'conversation-targets.json')) {
    this.filePath = path.resolve(filePath)
  }

  async getByConversation(conversationId: string): Promise<WorkspaceTargetDescriptor | null> {
    return this.getByKey(`conversation:${conversationId}`)
  }

  async getByKey(key: string): Promise<WorkspaceTargetDescriptor | null> {
    const targets = await this.readTargets()
    return targets[key] ? { ...targets[key] } : null
  }

  async getByTargetId(targetId: string): Promise<WorkspaceTargetDescriptor | null> {
    const targets = await this.readTargets()
    const target = Object.values(targets).find((entry) => entry.targetId === targetId)
    return target ? { ...target } : null
  }

  async saveForConversation(
    conversationId: string,
    target: WorkspaceTargetDescriptor,
  ): Promise<WorkspaceTargetDescriptor> {
    return this.saveForKey(`conversation:${conversationId}`, {
      ...target,
      conversationId,
    })
  }

  async saveForKey(
    key: string,
    target: WorkspaceTargetDescriptor,
  ): Promise<WorkspaceTargetDescriptor> {
    return this.withMutationLock(async () => {
      const targets = await this.readTargets()
      const nextTarget = {
        ...target,
      }
      targets[key] = nextTarget
      await this.writeTargets(targets)
      return { ...nextTarget }
    })
  }

  private async readTargets(): Promise<Record<string, WorkspaceTargetDescriptor>> {
    try {
      return parseTargets(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw error
    }
  }

  private async writeTargets(targets: Record<string, WorkspaceTargetDescriptor>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(
      this.filePath,
      `${JSON.stringify({ targets }, null, 2)}\n`,
      'utf8',
    )
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

export class WorkspacePreferencesStore {
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly filePath: string

  constructor(filePath = path.join(defaultWorkspaceDataDir(), 'preferences.json')) {
    this.filePath = path.resolve(filePath)
  }

  async get(): Promise<WorkspacePreferences> {
    try {
      return parsePreferences(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const created = parsePreferences(null)
        await this.write(created)
        return created
      }
      throw error
    }
  }

  async update(input: Partial<WorkspacePreferences>): Promise<WorkspacePreferences> {
    return this.withMutationLock(async () => {
      const current = await this.get()
      const next = {
        panelDefault: PANEL_DEFAULTS.has(input.panelDefault as WorkspacePanelDefault)
          ? input.panelDefault as WorkspacePanelDefault
          : current.panelDefault,
      }
      await this.write(next)
      return next
    })
  }

  private async write(preferences: WorkspacePreferences): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }
}
