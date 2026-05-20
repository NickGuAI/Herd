import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerChannelAdapter,
  resetChannelAdaptersForTests,
} from '../registry'
import { ChannelAdapterRuntimeManager } from '../runtime-manager'
import { CommanderChannelBindingStore } from '../store'
import type {
  ChannelAdapter,
  ChannelInboundDecision,
  ChannelPairingChallenge,
  ChannelRuntime,
  ChannelSendResult,
  CommanderChannelBinding,
} from '../types'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const OTHER_COMMANDER_ID = '33333333-3333-4333-8333-333333333333'
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-runtime-manager-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  resetChannelAdaptersForTests()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createFakeAdapter(input: {
  start: ChannelAdapter['start']
  stop: ChannelAdapter['stop']
}): ChannelAdapter {
  return {
    provider: 'whatsapp',
    capabilities: {
      voiceNotes: true,
      media: true,
      threading: false,
      typingIndicators: false,
      presence: false,
      reactions: false,
      markdownDialect: 'whatsapp',
    },
    start: input.start,
    stop: input.stop,
    beginPairing: async (): Promise<ChannelPairingChallenge> => ({ provider: 'whatsapp' }),
    completePairing: async (): Promise<CommanderChannelBinding> => {
      throw new Error('not used')
    },
    send: async (): Promise<ChannelSendResult> => ({ success: true }),
    checkInboundAllowed: async (): Promise<ChannelInboundDecision> => ({ allowed: true }),
  }
}

describe('ChannelAdapterRuntimeManager', () => {
  it('starts a replacement binding when the current account runtime binding is disabled', async () => {
    const dir = await createTempDir()
    const store = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const first = await store.create({
      commanderId: COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp A',
      config: { provider: 'whatsapp' },
    })
    const second = await store.create({
      commanderId: OTHER_COMMANDER_ID,
      provider: 'whatsapp',
      accountId: 'pm-ai',
      displayName: 'PMI WhatsApp B',
      config: { provider: 'whatsapp' },
    })
    const runtimes: ChannelRuntime[] = []
    const start = vi.fn<ChannelAdapter['start']>(async (binding) => {
      const runtime = {
        provider: binding.provider,
        accountId: binding.accountId,
        commanderId: binding.commanderId,
        accountBinding: binding,
      }
      runtimes.push(runtime)
      return runtime
    })
    const stop = vi.fn<ChannelAdapter['stop']>(async () => undefined)
    registerChannelAdapter(createFakeAdapter({ start, stop }))
    const manager = new ChannelAdapterRuntimeManager({
      bindingStore: store,
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
      },
    })

    await manager.syncBinding(first)
    const disabled = await store.update(first.commanderId, first.id, { enabled: false })
    await manager.syncBinding(disabled!)

    expect(start).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: first.id }))
    expect(start).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: second.id }))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(runtimes[0])
  })
})
