import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHammurabiDataDir } from '../data-dir.js'
import { writeJsonFileAtomically } from '../../migrations/write-json-file-atomically.js'
import type { ChannelProvider, ChannelSurfaceBinding } from './types.js'

export type UpsertChannelSurfaceBindingInput =
  Omit<ChannelSurfaceBinding, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  }

interface PersistedChannelSurfaceBindings {
  bindings: ChannelSurfaceBinding[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function asBoolean(value: unknown, defaultValue: boolean): boolean {
  return value === undefined ? defaultValue : value === true
}

function asConfig(value: unknown): Record<string, unknown> {
  return isObject(value) ? { ...value } : {}
}

function cloneBinding(binding: ChannelSurfaceBinding): ChannelSurfaceBinding {
  return {
    ...binding,
    config: { ...binding.config },
  }
}

function parseSurfaceBinding(raw: unknown): ChannelSurfaceBinding | null {
  if (!isObject(raw)) {
    return null
  }

  const id = asNonEmptyString(raw.id)
  const provider = asNonEmptyString(raw.provider)
  const accountId = asNonEmptyString(raw.accountId)
  const peerId = asNonEmptyString(raw.peerId)
  const surfaceKey = asNonEmptyString(raw.surfaceKey)
  const commanderId = asNonEmptyString(raw.commanderId)
  const conversationId = asNonEmptyString(raw.conversationId)
  const createdAt = asNonEmptyString(raw.createdAt)
  if (!id || !provider || !accountId || !peerId || !surfaceKey || !commanderId || !conversationId || !createdAt) {
    return null
  }

  return {
    id,
    provider: provider as ChannelProvider,
    accountId,
    peerId,
    threadId: asOptionalString(raw.threadId),
    surfaceKey,
    commanderId,
    conversationId,
    enabled: asBoolean(raw.enabled, true),
    config: asConfig(raw.config),
    createdAt,
  }
}

export function defaultChannelSurfaceBindingStorePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveHammurabiDataDir(env), 'channels', 'surface-bindings.json')
}

export function channelSurfaceBindingStorePathForDataRoot(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), 'channels', 'surface-bindings.json')
}

export class ChannelSurfaceBindingStore {
  private readonly filePath: string
  private bindingsById: Map<string, ChannelSurfaceBinding> | null = null
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string = defaultChannelSurfaceBindingStorePath()) {
    this.filePath = path.resolve(filePath)
  }

  async getBySurfaceKey(surfaceKey: string): Promise<ChannelSurfaceBinding | null> {
    await this.ensureLoaded()
    const normalizedSurfaceKey = requireNonEmpty(surfaceKey, 'surfaceKey')
    const found = [...this.bindings().values()].find(
      (binding) => binding.surfaceKey === normalizedSurfaceKey && binding.enabled,
    )
    return found ? cloneBinding(found) : null
  }

  async getByConversationId(conversationId: string): Promise<ChannelSurfaceBinding | null> {
    await this.ensureLoaded()
    const normalizedConversationId = requireNonEmpty(conversationId, 'conversationId')
    const found = [...this.bindings().values()].find(
      (binding) => binding.conversationId === normalizedConversationId && binding.enabled,
    )
    return found ? cloneBinding(found) : null
  }

  async list(): Promise<ChannelSurfaceBinding[]> {
    await this.ensureLoaded()
    return [...this.bindings().values()]
      .map((binding) => cloneBinding(binding))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async upsertAtomic(
    input: UpsertChannelSurfaceBindingInput,
  ): Promise<{ binding: ChannelSurfaceBinding; created: boolean }> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const normalized = normalizeInput(input)
      const existing = [...this.bindings().values()].find(
        (binding) => binding.surfaceKey === normalized.surfaceKey && binding.enabled,
      )
      if (existing) {
        return { binding: cloneBinding(existing), created: false }
      }

      this.bindings().set(normalized.id, cloneBinding(normalized))
      await this.writeToDisk()
      return { binding: cloneBinding(normalized), created: true }
    })
  }

  async deleteByBinding(bindingId: string): Promise<boolean> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const normalizedBindingId = requireNonEmpty(bindingId, 'bindingId')
      const deleted = this.bindings().delete(normalizedBindingId)
      if (deleted) {
        await this.writeToDisk()
      }
      return deleted
    })
  }

  private bindings(): Map<string, ChannelSurfaceBinding> {
    if (!this.bindingsById) {
      throw new Error('ChannelSurfaceBindingStore not loaded')
    }
    return this.bindingsById
  }

  private async ensureLoaded(): Promise<void> {
    if (this.bindingsById) {
      return
    }
    if (this.loadPromise) {
      await this.loadPromise
      return
    }

    this.loadPromise = (async () => {
      const bindings = await this.readFromDisk()
      this.bindingsById = new Map(bindings.map((binding) => [binding.id, cloneBinding(binding)]))
    })()

    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async readFromDisk(): Promise<ChannelSurfaceBinding[]> {
    let rawFile: string
    try {
      rawFile = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawFile) as unknown
    } catch {
      return []
    }

    const candidates = Array.isArray(parsed)
      ? parsed
      : (isObject(parsed) && Array.isArray(parsed.bindings) ? parsed.bindings : [])
    return candidates
      .map((candidate) => parseSurfaceBinding(candidate))
      .filter((binding): binding is ChannelSurfaceBinding => binding !== null)
  }

  private async writeToDisk(): Promise<void> {
    const bindings = [...this.bindings().values()]
      .map((binding) => cloneBinding(binding))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    const payload: PersistedChannelSurfaceBindings = { bindings }
    await writeJsonFileAtomically(this.filePath, payload, { trailingNewline: true })
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

function requireNonEmpty(value: unknown, field: string): string {
  const normalized = asNonEmptyString(value)
  if (!normalized) {
    throw new Error(`${field} is required`)
  }
  return normalized
}

function normalizeInput(input: UpsertChannelSurfaceBindingInput): ChannelSurfaceBinding {
  return {
    id: asNonEmptyString(input.id) ?? randomUUID(),
    provider: requireNonEmpty(input.provider, 'provider') as ChannelProvider,
    accountId: requireNonEmpty(input.accountId, 'accountId'),
    peerId: requireNonEmpty(input.peerId, 'peerId'),
    threadId: asOptionalString(input.threadId),
    surfaceKey: requireNonEmpty(input.surfaceKey, 'surfaceKey'),
    commanderId: requireNonEmpty(input.commanderId, 'commanderId'),
    conversationId: requireNonEmpty(input.conversationId, 'conversationId'),
    enabled: input.enabled === false ? false : true,
    config: asConfig(input.config),
    createdAt: asNonEmptyString(input.createdAt) ?? new Date().toISOString(),
  }
}
