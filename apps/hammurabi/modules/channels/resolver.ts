import { randomUUID } from 'node:crypto'
import type { Conversation, ConversationStore } from '../commanders/conversation-store.js'
import type { CommanderChannelMeta, CommanderLastRoute } from '../commanders/store.js'
import { CommanderChannelBindingStore } from './store.js'
import { checkAccountInboundPolicy } from './policy.js'
import { computeChannelSurfaceKey } from './surface-key.js'
import {
  ChannelSurfaceBindingStore,
} from './surface-binding-store.js'
import type {
  ChannelInboundEvent,
  ChannelSurfaceBinding,
  CommanderChannelBinding,
} from './types.js'

export class CommanderMismatchError extends Error {
  readonly statusCode = 403
  readonly requestedCommanderId: string
  readonly bindingCommanderId: string
  readonly surfaceKey: string

  constructor(input: {
    requestedCommanderId: string
    bindingCommanderId: string
    surfaceKey: string
  }) {
    super(
      `Channel surface "${input.surfaceKey}" is bound to commander `
      + `"${input.bindingCommanderId}", not commander "${input.requestedCommanderId}"`,
    )
    this.name = 'CommanderMismatchError'
    this.requestedCommanderId = input.requestedCommanderId
    this.bindingCommanderId = input.bindingCommanderId
    this.surfaceKey = input.surfaceKey
  }
}

export interface ResolveInboundChannelMessageInput {
  event: ChannelInboundEvent
  commanderId?: string
  channelMeta: CommanderChannelMeta
  lastRoute: CommanderLastRoute
}

export type ResolveInboundChannelMessageResult =
  | {
    ok: true
    binding: ChannelSurfaceBinding
    conversation: Conversation
    created: boolean
  }
  | {
    ok: false
    dropped: true
    reason:
      | 'missing-account-binding'
      | 'ambiguous-account-binding'
      | 'policy-denied'
  }

export interface InboundChannelResolverOptions {
  surfaceBindingStore?: ChannelSurfaceBindingStore
  accountBindingStore?: CommanderChannelBindingStore
  conversationStore: ConversationStore
}

const creationLocks = new Map<string, Promise<ResolveInboundChannelMessageResult>>()

export async function resolveInboundChannelMessage(
  input: ResolveInboundChannelMessageInput,
  options: InboundChannelResolverOptions,
): Promise<ResolveInboundChannelMessageResult> {
  const surfaceBindingStore = options.surfaceBindingStore ?? new ChannelSurfaceBindingStore()
  const accountBindingStore = options.accountBindingStore ?? new CommanderChannelBindingStore()
  const surfaceKey = computeChannelSurfaceKey(input.event)

  const existingBinding = await surfaceBindingStore.getBySurfaceKey(surfaceKey)
  if (existingBinding) {
    const resolved = await resolveReusableSurfaceBinding(
      input,
      existingBinding,
      surfaceBindingStore,
      accountBindingStore,
      options.conversationStore,
    )
    if (resolved.kind === 'found') {
      return {
        ok: true,
        binding: resolved.binding,
        conversation: resolved.conversation,
        created: false,
      }
    }
    if (resolved.kind === 'dropped') {
      return { ok: false, dropped: true, reason: resolved.reason }
    }
  }

  return withSurfaceCreationLock(surfaceKey, async () => {
    const racedBinding = await surfaceBindingStore.getBySurfaceKey(surfaceKey)
    if (racedBinding) {
      const resolved = await resolveReusableSurfaceBinding(
        input,
        racedBinding,
        surfaceBindingStore,
        accountBindingStore,
        options.conversationStore,
      )
      if (resolved.kind === 'found') {
        return {
          ok: true,
          binding: resolved.binding,
          conversation: resolved.conversation,
          created: false,
        }
      }
      if (resolved.kind === 'dropped') {
        return { ok: false, dropped: true, reason: resolved.reason }
      }
    }

    const accountBinding = await resolveAccountBinding(accountBindingStore, input)
    if (accountBinding.kind === 'missing') {
      return { ok: false, dropped: true, reason: 'missing-account-binding' }
    }
    if (accountBinding.kind === 'ambiguous') {
      return { ok: false, dropped: true, reason: 'ambiguous-account-binding' }
    }

    const allowed = checkAccountInboundPolicy(accountBinding.binding, input.event)
    if (!allowed.allowed) {
      return { ok: false, dropped: true, reason: 'policy-denied' }
    }

    const nowIso = new Date().toISOString()
    const conversationId = randomUUID()
    const conversation = await options.conversationStore.create({
      id: conversationId,
      commanderId: accountBinding.binding.commanderId,
      surface: input.event.provider,
      channelMeta: input.channelMeta,
      lastRoute: input.lastRoute,
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: 'channel',
      createdByKind: 'channel',
      createdById: input.event.provider,
      requestId: surfaceKey,
      createdAt: nowIso,
      lastMessageAt: nowIso,
    })

    const surfaceBindingInput = {
      provider: input.event.provider,
      accountId: input.event.accountId,
      peerId: input.event.peerId,
      threadId: input.event.threadId,
      surfaceKey,
      commanderId: accountBinding.binding.commanderId,
      conversationId: conversation.id,
      enabled: true,
      config: {
        channelMeta: input.channelMeta,
        lastRoute: input.lastRoute,
      },
      createdAt: nowIso,
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const upserted = await surfaceBindingStore.upsertAtomic(surfaceBindingInput)
      if (upserted.created || upserted.binding.conversationId === conversation.id) {
        return {
          ok: true,
          binding: upserted.binding,
          conversation,
          created: true,
        }
      }

      let resolved: ReusableSurfaceBindingResolution
      try {
        resolved = await resolveReusableSurfaceBinding(
          input,
          upserted.binding,
          surfaceBindingStore,
          accountBindingStore,
          options.conversationStore,
        )
      } catch (error) {
        await options.conversationStore.delete(conversation.id).catch(() => null)
        throw error
      }

      if (resolved.kind === 'found') {
        await options.conversationStore.delete(conversation.id).catch(() => null)
        return {
          ok: true,
          binding: resolved.binding,
          conversation: resolved.conversation,
          created: false,
        }
      }
      if (resolved.kind === 'dropped') {
        await options.conversationStore.delete(conversation.id).catch(() => null)
        return { ok: false, dropped: true, reason: resolved.reason }
      }
    }

    await options.conversationStore.delete(conversation.id).catch(() => null)
    throw new Error(`Channel surface "${surfaceKey}" remained bound to stale conversations`)
  })
}

type ReusableSurfaceBindingResolution =
  | { kind: 'found'; binding: ChannelSurfaceBinding; conversation: Conversation }
  | { kind: 'inactive' }
  | { kind: 'dropped'; reason: 'missing-account-binding' | 'ambiguous-account-binding' | 'policy-denied' }

async function resolveReusableSurfaceBinding(
  input: ResolveInboundChannelMessageInput,
  binding: ChannelSurfaceBinding,
  surfaceBindingStore: ChannelSurfaceBindingStore,
  accountBindingStore: CommanderChannelBindingStore,
  conversationStore: ConversationStore,
): Promise<ReusableSurfaceBindingResolution> {
  if (!binding.enabled) {
    return { kind: 'inactive' }
  }

  const conversation = await conversationStore.get(binding.conversationId)
  if (!conversation) {
    await surfaceBindingStore.deleteByBinding(binding.id)
    return { kind: 'inactive' }
  }

  assertCommanderMatchesBinding(input, binding)
  const accountBinding = await resolveAccountBindingForSurface(accountBindingStore, binding)
  if (accountBinding.kind === 'missing') {
    return { kind: 'dropped', reason: 'missing-account-binding' }
  }
  if (accountBinding.kind === 'ambiguous') {
    return { kind: 'dropped', reason: 'ambiguous-account-binding' }
  }

  const allowed = checkAccountInboundPolicy(accountBinding.binding, input.event)
  if (!allowed.allowed) {
    return { kind: 'dropped', reason: 'policy-denied' }
  }

  return { kind: 'found', binding, conversation }
}

function assertCommanderMatchesBinding(
  input: ResolveInboundChannelMessageInput,
  binding: ChannelSurfaceBinding,
): void {
  if (input.commanderId && input.commanderId !== binding.commanderId) {
    throw new CommanderMismatchError({
      requestedCommanderId: input.commanderId,
      bindingCommanderId: binding.commanderId,
      surfaceKey: binding.surfaceKey,
    })
  }
}

async function withSurfaceCreationLock(
  surfaceKey: string,
  operation: () => Promise<ResolveInboundChannelMessageResult>,
): Promise<ResolveInboundChannelMessageResult> {
  const existing = creationLocks.get(surfaceKey)
  if (existing) {
    return existing
  }
  const current = operation().finally(() => {
    if (creationLocks.get(surfaceKey) === current) {
      creationLocks.delete(surfaceKey)
    }
  })
  creationLocks.set(surfaceKey, current)
  return current
}

async function resolveAccountBindingForSurface(
  store: CommanderChannelBindingStore,
  binding: ChannelSurfaceBinding,
): Promise<
  | { kind: 'found'; binding: CommanderChannelBinding }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }
> {
  const bindings = (await store.list()).filter((accountBinding) => (
    accountBinding.enabled
    && accountBinding.commanderId === binding.commanderId
    && accountBinding.provider === binding.provider
    && accountBinding.accountId === binding.accountId
  ))

  if (bindings.length === 0) {
    return { kind: 'missing' }
  }
  if (bindings.length > 1) {
    return { kind: 'ambiguous' }
  }
  return { kind: 'found', binding: bindings[0]! }
}

async function resolveAccountBinding(
  store: CommanderChannelBindingStore,
  input: ResolveInboundChannelMessageInput,
): Promise<
  | { kind: 'found'; binding: CommanderChannelBinding }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }
> {
  const bindings = (await store.list()).filter((binding) => (
    binding.enabled
    && binding.provider === input.event.provider
    && binding.accountId === input.event.accountId
    && (!input.commanderId || binding.commanderId === input.commanderId)
  ))

  if (bindings.length === 0) {
    return { kind: 'missing' }
  }
  if (bindings.length > 1) {
    return { kind: 'ambiguous' }
  }
  return { kind: 'found', binding: bindings[0]! }
}
