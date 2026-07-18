import { createHmac, randomBytes } from 'node:crypto'
import { secureTokenEqual } from '../../server/middleware/secure-compare.js'

export const APPROVAL_BRIDGE_TOKEN_ENV = 'HERD_APPROVAL_BRIDGE_TOKEN'
export const APPROVAL_BRIDGE_TOKEN_HEADER = 'x-herd-approval-bridge-token'

const APPROVAL_BRIDGE_TOKEN_PREFIX = 'hmab'
const SESSION_SCOPED_TOKEN_VERSION = 2
const CONVERSATION_SCOPED_TOKEN_VERSION = 3

/**
 * Session-scoped claims (v2). Legacy for non-conversation sessions and for
 * tokens minted before the conversation-lifetime upgrade. The credential is
 * bound to one live provider session via its nonce.
 */
export interface SessionScopedApprovalBridgeClaims {
  v: typeof SESSION_SCOPED_TOKEN_VERSION
  sessionName: string
  nonce: string
}

/**
 * Conversation-scoped claims (v3). The credential is owned by the Command
 * Room conversation, not by any single provider runtime session. Every
 * provider process spawned for the conversation — before or after any
 * replacement, rotation, recovery, or relaunch — holds an equivalent token.
 * `sessionName` is a diagnostic label only; it is never the authority
 * boundary.
 */
export interface ConversationScopedApprovalBridgeClaims {
  v: typeof CONVERSATION_SCOPED_TOKEN_VERSION
  conversationId: string
  credentialId: string
  epoch: number
  sessionName?: string
}

export type ApprovalBridgeTokenClaims =
  | SessionScopedApprovalBridgeClaims
  | ConversationScopedApprovalBridgeClaims

export type ApprovalBridgeTokenVerification =
  | { ok: true; claims: ApprovalBridgeTokenClaims }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' }

export function createApprovalBridgeNonce(): string {
  return randomBytes(16).toString('base64url')
}

export function createApprovalBridgeCredentialId(): string {
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

function decodeSessionScopedClaims(
  record: Record<string, unknown>,
): SessionScopedApprovalBridgeClaims | null {
  if (
    typeof record.sessionName !== 'string' ||
    record.sessionName.trim().length === 0 ||
    typeof record.nonce !== 'string' ||
    record.nonce.trim().length === 0
  ) {
    return null
  }

  return {
    v: SESSION_SCOPED_TOKEN_VERSION,
    sessionName: record.sessionName.trim(),
    nonce: record.nonce.trim(),
  }
}

function decodeConversationScopedClaims(
  record: Record<string, unknown>,
): ConversationScopedApprovalBridgeClaims | null {
  if (
    typeof record.conversationId !== 'string' ||
    record.conversationId.trim().length === 0 ||
    typeof record.credentialId !== 'string' ||
    record.credentialId.trim().length === 0 ||
    typeof record.epoch !== 'number' ||
    !Number.isInteger(record.epoch) ||
    record.epoch < 1
  ) {
    return null
  }

  const sessionName = typeof record.sessionName === 'string' && record.sessionName.trim().length > 0
    ? record.sessionName.trim()
    : undefined
  return {
    v: CONVERSATION_SCOPED_TOKEN_VERSION,
    conversationId: record.conversationId.trim(),
    credentialId: record.credentialId.trim(),
    epoch: record.epoch,
    ...(sessionName ? { sessionName } : {}),
  }
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
  if (record.v === SESSION_SCOPED_TOKEN_VERSION) {
    return decodeSessionScopedClaims(record)
  }
  if (record.v === CONVERSATION_SCOPED_TOKEN_VERSION) {
    return decodeConversationScopedClaims(record)
  }
  return null
}

function mintToken(claims: ApprovalBridgeTokenClaims, signingSecret: string): string {
  const payload = encodeClaims(claims)
  return `${APPROVAL_BRIDGE_TOKEN_PREFIX}.${payload}.${signPayload(payload, signingSecret)}`
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

  return mintToken({
    v: SESSION_SCOPED_TOKEN_VERSION,
    sessionName,
    nonce,
  }, signingSecret)
}

export function createConversationApprovalBridgeToken(options: {
  signingSecret: string
  conversationId: string
  credentialId: string
  epoch: number
  sessionName?: string
}): string {
  const signingSecret = options.signingSecret.trim()
  const conversationId = options.conversationId.trim()
  const credentialId = options.credentialId.trim()
  const sessionName = options.sessionName?.trim()
  if (!signingSecret) {
    throw new Error('signingSecret is required to mint approval bridge tokens')
  }
  if (!conversationId) {
    throw new Error('conversationId is required to mint conversation approval bridge tokens')
  }
  if (!credentialId) {
    throw new Error('credentialId is required to mint conversation approval bridge tokens')
  }
  if (!Number.isInteger(options.epoch) || options.epoch < 1) {
    throw new Error('epoch must be a positive integer to mint conversation approval bridge tokens')
  }

  return mintToken({
    v: CONVERSATION_SCOPED_TOKEN_VERSION,
    conversationId,
    credentialId,
    epoch: options.epoch,
    ...(sessionName ? { sessionName } : {}),
  }, signingSecret)
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

  return { ok: true, claims }
}
