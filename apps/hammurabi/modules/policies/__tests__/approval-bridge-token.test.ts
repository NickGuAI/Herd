import { describe, expect, it, vi } from 'vitest'
import {
  createApprovalBridgeNonce,
  createApprovalBridgeToken,
  verifyApprovalBridgeToken,
} from '../approval-bridge-token'

describe('approval bridge token', () => {
  it('round-trips a session-scoped token without wall-clock expiry', () => {
    const nonce = 'nonce-stream-worker-01'
    const token = createApprovalBridgeToken({
      signingSecret: 'approval-bridge-secret',
      sessionName: 'stream-worker-01',
      nonce,
    })

    expect(verifyApprovalBridgeToken(token, {
      signingSecret: 'approval-bridge-secret',
    })).toEqual({
      ok: true,
      sessionName: 'stream-worker-01',
      nonce,
    })
  })

  it('keeps the same credential valid after more than 24 hours of simulated time', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-18T00:00:00.000Z'))
      const nonce = 'nonce-long-lived-stream-worker'
      const token = createApprovalBridgeToken({
        signingSecret: 'approval-bridge-secret',
        sessionName: 'stream-worker-long-lived',
        nonce,
      })

      vi.setSystemTime(new Date('2026-06-19T00:00:01.000Z'))
      expect(verifyApprovalBridgeToken(token, {
        signingSecret: 'approval-bridge-secret',
      })).toEqual({
        ok: true,
        sessionName: 'stream-worker-long-lived',
        nonce,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('generates non-empty nonce values for session credential binding', () => {
    expect(createApprovalBridgeNonce()).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  it('rejects tampered tokens and wrong signing secrets', () => {
    const token = createApprovalBridgeToken({
      signingSecret: 'approval-bridge-secret',
      sessionName: 'stream-worker-01',
      nonce: 'nonce-stream-worker-01',
    })

    expect(verifyApprovalBridgeToken(token, {
      signingSecret: 'other-secret',
    })).toEqual({ ok: false, reason: 'invalid' })

    expect(verifyApprovalBridgeToken(`${token}x`, {
      signingSecret: 'approval-bridge-secret',
    })).toEqual({ ok: false, reason: 'invalid' })
  })
})
