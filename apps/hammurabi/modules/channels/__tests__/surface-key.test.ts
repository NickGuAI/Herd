import { describe, expect, it } from 'vitest'
import { getSurfaceKey } from '../surface-key'

describe('getSurfaceKey', () => {
  it('uses one account-scoped formula for every provider', () => {
    for (const provider of ['whatsapp', 'telegram', 'discord', 'circle', 'slack']) {
      expect(getSurfaceKey({ provider, accountId: 'A', peerId: 'P' }))
        .toBe(`${provider}:A:P`)
      expect(getSurfaceKey({ provider, accountId: 'A', peerId: 'P', threadId: 'T' }))
        .toBe(`${provider}:A:P:T`)
      expect(getSurfaceKey({ provider, accountId: 'A', peerId: 'P' }))
        .not.toBe(getSurfaceKey({ provider, accountId: 'B', peerId: 'P' }))
    }
  })
})
