import { createHmac } from 'node:crypto'
import { secureTokenEqual } from '../../../server/middleware/secure-compare.js'

export const MACHINE_DAEMON_PAIRING_TOKEN_TTL_DAYS = 180
export const MACHINE_DAEMON_PAIRING_TOKEN_TTL_MS = MACHINE_DAEMON_PAIRING_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
export const MACHINE_ENROLLMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const MACHINE_ENROLLMENT_TOKEN_PREFIX = 'hmre_'
const MACHINE_ENROLLMENT_TOKEN_VERSION = 1

interface MachineEnrollmentTokenClaims {
  v: typeof MACHINE_ENROLLMENT_TOKEN_VERSION
  expiresAt: string
  label?: string
  cwd?: string
  endpoint?: string
}

export type MachineEnrollmentTokenVerification =
  | {
      ok: true
      expiresAt: string
      label?: string
      cwd?: string
      endpoint?: string
    }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' | 'expired' }

function signPayload(payload: string, signingSecret: string): string {
  return createHmac('sha256', signingSecret.trim())
    .update(payload, 'utf8')
    .digest('base64url')
}

function encodeClaims(claims: MachineEnrollmentTokenClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
}

function decodeClaims(payload: string): MachineEnrollmentTokenClaims | null {
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
    record.v !== MACHINE_ENROLLMENT_TOKEN_VERSION ||
    typeof record.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    return null
  }

  const label = typeof record.label === 'string' && record.label.trim().length > 0
    ? record.label.trim()
    : undefined
  const cwd = typeof record.cwd === 'string' && record.cwd.trim().length > 0
    ? record.cwd.trim()
    : undefined
  const endpoint = typeof record.endpoint === 'string' && record.endpoint.trim().length > 0
    ? record.endpoint.trim().replace(/\/+$/u, '')
    : undefined

  if (cwd && !cwd.startsWith('/')) {
    return null
  }

  return {
    v: MACHINE_ENROLLMENT_TOKEN_VERSION,
    expiresAt: record.expiresAt,
    ...(label ? { label } : {}),
    ...(cwd ? { cwd } : {}),
    ...(endpoint ? { endpoint } : {}),
  }
}

function createMachineTokenExpiresAt(
  nowMs: number | undefined,
  ttlMs: number,
): string {
  return new Date((nowMs ?? Date.now()) + ttlMs).toISOString()
}

export function isMachineTokenExpired(
  expiresAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!expiresAt) {
    return false
  }
  const expiresAtMs = Date.parse(expiresAt)
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs
}

export function createMachineEnrollmentToken(options: {
  signingSecret: string
  label?: string
  cwd?: string
  endpoint?: string
  nowMs?: number
  ttlMs?: number
}): { token: string; expiresAt: string } {
  const signingSecret = options.signingSecret.trim()
  if (!signingSecret) {
    throw new Error('signingSecret is required to mint machine enrollment tokens')
  }
  const label = options.label?.trim()
  const cwd = options.cwd?.trim()
  const endpoint = options.endpoint?.trim().replace(/\/+$/u, '')
  if (cwd && !cwd.startsWith('/')) {
    throw new Error('cwd must be an absolute path when provided')
  }

  const expiresAt = createMachineTokenExpiresAt(
    options.nowMs,
    options.ttlMs ?? MACHINE_ENROLLMENT_TOKEN_TTL_MS,
  )
  const payload = encodeClaims({
    v: MACHINE_ENROLLMENT_TOKEN_VERSION,
    expiresAt,
    ...(label ? { label } : {}),
    ...(cwd ? { cwd } : {}),
    ...(endpoint ? { endpoint } : {}),
  })
  const signature = signPayload(payload, signingSecret)
  return {
    token: `${MACHINE_ENROLLMENT_TOKEN_PREFIX}${payload}.${signature}`,
    expiresAt,
  }
}

export function verifyMachineEnrollmentToken(
  token: string | null | undefined,
  options: {
    signingSecret?: string
    nowMs?: number
  },
): MachineEnrollmentTokenVerification {
  const normalizedToken = token?.trim()
  const signingSecret = options.signingSecret?.trim()
  if (!normalizedToken) {
    return { ok: false, reason: 'missing' }
  }
  if (!signingSecret) {
    return { ok: false, reason: 'invalid' }
  }
  if (!normalizedToken.startsWith(MACHINE_ENROLLMENT_TOKEN_PREFIX)) {
    return { ok: false, reason: 'malformed' }
  }

  const body = normalizedToken.slice(MACHINE_ENROLLMENT_TOKEN_PREFIX.length)
  const [payload, signature, extra] = body.split('.')
  if (!payload || !signature || extra !== undefined) {
    return { ok: false, reason: 'malformed' }
  }

  const expectedSignature = signPayload(payload, signingSecret)
  if (!secureTokenEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'invalid' }
  }

  const claims = decodeClaims(payload)
  if (!claims) {
    return { ok: false, reason: 'malformed' }
  }
  if (isMachineTokenExpired(claims.expiresAt, options.nowMs)) {
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    expiresAt: claims.expiresAt,
    ...(claims.label ? { label: claims.label } : {}),
    ...(claims.cwd ? { cwd: claims.cwd } : {}),
    ...(claims.endpoint ? { endpoint: claims.endpoint } : {}),
  }
}
