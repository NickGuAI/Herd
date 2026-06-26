import { createHmac, randomBytes } from 'node:crypto'
import { secureTokenEqual } from '../../server/middleware/secure-compare.js'

export const APPROVAL_BRIDGE_TOKEN_ENV = 'HERD_APPROVAL_BRIDGE_TOKEN'
export const APPROVAL_BRIDGE_TOKEN_HEADER = 'x-herd-approval-bridge-token'

const APPROVAL_BRIDGE_TOKEN_PREFIX = 'hmab'
const APPROVAL_BRIDGE_TOKEN_VERSION = 2

interface ApprovalBridgeTokenClaims {
  v: typeof APPROVAL_BRIDGE_TOKEN_VERSION
  sessionName: string
  nonce: string
}

export type ApprovalBridgeTokenVerification =
  | { ok: true; sessionName: string; nonce: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' }

export function createApprovalBridgeNonce(): string {
  return randomBytes(16).toString('base64url')
}

function signPayload(payload: string, signingSecret: string): string {
  return createHmac('sha256', signingSecret.trim())
    .update(payload, 'utf8')
    .digest('base64url')
}

function encodeClaims(claims: ApprovalBridgeTokenClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
}

function decodeClaims(payload: string): ApprovalBridgeTokenClaims | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const record = parsed as Record<string, unknown>
  if (
    record.v !== APPROVAL_BRIDGE_TOKEN_VERSION ||
    typeof record.sessionName !== 'string' ||
    record.sessionName.trim().length === 0 ||
    typeof record.nonce !== 'string' ||
    record.nonce.trim().length === 0
  ) {
    return null
  }

  return {
    v: APPROVAL_BRIDGE_TOKEN_VERSION,
    sessionName: record.sessionName.trim(),
    nonce: record.nonce.trim(),
  }
}

export function createApprovalBridgeToken(options: {
  signingSecret: string
  sessionName: string
  nonce: string
}): string {
  const signingSecret = options.signingSecret.trim()
  const sessionName = options.sessionName.trim()
  const nonce = options.nonce.trim()
  if (!signingSecret) {
    throw new Error('signingSecret is required to mint approval bridge tokens')
  }
  if (!sessionName) {
    throw new Error('sessionName is required to mint approval bridge tokens')
  }
  if (!nonce) {
    throw new Error('nonce is required to mint approval bridge tokens')
  }

  const payload = encodeClaims({
    v: APPROVAL_BRIDGE_TOKEN_VERSION,
    sessionName,
    nonce,
  })
  return `${APPROVAL_BRIDGE_TOKEN_PREFIX}.${payload}.${signPayload(payload, signingSecret)}`
}

export function verifyApprovalBridgeToken(
  token: string | null | undefined,
  options: {
    signingSecret?: string
  },
): ApprovalBridgeTokenVerification {
  const normalizedToken = token?.trim()
  const signingSecret = options.signingSecret?.trim()
  if (!normalizedToken) {
    return { ok: false, reason: 'missing' }
  }
  if (!signingSecret) {
    return { ok: false, reason: 'invalid' }
  }

  const parts = normalizedToken.split('.')
  if (parts.length !== 3 || parts[0] !== APPROVAL_BRIDGE_TOKEN_PREFIX) {
    return { ok: false, reason: 'malformed' }
  }

  const [, payload, signature] = parts
  const expectedSignature = signPayload(payload, signingSecret)
  if (!secureTokenEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'invalid' }
  }

  const claims = decodeClaims(payload)
  if (!claims) {
    return { ok: false, reason: 'malformed' }
  }

  return {
    ok: true,
    sessionName: claims.sessionName,
    nonce: claims.nonce,
  }
}
