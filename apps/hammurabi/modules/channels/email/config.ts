import { createHash } from 'node:crypto'
import type { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import { EMAIL_CHANNEL_CONFIG_DEFAULTS } from '../descriptors.js'
import type { CommanderChannelBindingConfig } from '../types.js'

const DEFAULT_IMAP_HOST = EMAIL_CHANNEL_CONFIG_DEFAULTS.imapHost
const DEFAULT_IMAP_PORT = EMAIL_CHANNEL_CONFIG_DEFAULTS.imapPort
const DEFAULT_SMTP_HOST = EMAIL_CHANNEL_CONFIG_DEFAULTS.smtpHost
const DEFAULT_SMTP_PORT = EMAIL_CHANNEL_CONFIG_DEFAULTS.smtpPort
const DEFAULT_POLL_INTERVAL_MS = EMAIL_CHANNEL_CONFIG_DEFAULTS.pollIntervalMs

export interface EmailChannelConfig {
  provider: 'email'
  username: string
  fromAddress: string
  replyFromAddress?: string
  emailAlias?: string
  defaultCommanderId?: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapMailbox: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  pollIntervalMs: number
  allowlist: string[]
  globalAllowlist: string[]
  credentialRef?: string
  credentialConfigured: boolean
}

export interface PreparedEmailChannelConfig {
  config: CommanderChannelBindingConfig
  credentialUpdated: boolean
  commitCredential?: () => Promise<void>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parsePort(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' && value.trim()
    ? Number(value.trim())
    : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback
  }
  const normalized = Math.trunc(raw)
  return normalized > 0 && normalized <= 65_535 ? normalized : fallback
}

function parsePollIntervalMs(value: unknown): number {
  const raw = typeof value === 'string' && value.trim()
    ? Number(value.trim())
    : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_POLL_INTERVAL_MS
  }
  const normalized = Math.trunc(raw)
  return normalized >= 5_000 ? normalized : DEFAULT_POLL_INTERVAL_MS
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  for (const entry of value) {
    const normalized = trimString(entry)
    if (normalized) {
      seen.add(normalized)
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right))
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function emailCredentialRef(accountId: string): string {
  const digest = createHash('sha256')
    .update(normalizeEmail(accountId))
    .digest('hex')
    .slice(0, 20)
  return `email:${digest}:app-password`
}

export function parseEmailChannelConfig(
  raw: unknown,
  accountId: string,
): EmailChannelConfig {
  const source = isObject(raw) ? raw : {}
  const username = trimString(source.username) ?? trimString(source.account) ?? accountId
  const fromAddress = trimString(source.fromAddress) ?? trimString(source.replyAccount) ?? username
  const replyFromAddress = trimString(source.replyFromAddress)
  const emailAlias = trimString(source.emailAlias)
  const defaultCommanderId = trimString(source.defaultCommanderId)
  const credentialRef = trimString(source.credentialRef)
  const allowlist = parseStringList(source.allowlist)
  const globalAllowlist = parseStringList(source.globalAllowlist)

  return {
    provider: 'email',
    username,
    fromAddress,
    ...(replyFromAddress ? { replyFromAddress } : {}),
    ...(emailAlias ? { emailAlias } : {}),
    ...(defaultCommanderId ? { defaultCommanderId } : {}),
    imapHost: trimString(source.imapHost) ?? DEFAULT_IMAP_HOST,
    imapPort: parsePort(source.imapPort, DEFAULT_IMAP_PORT),
    imapSecure: parseBoolean(source.imapSecure, EMAIL_CHANNEL_CONFIG_DEFAULTS.imapSecure),
    imapMailbox: trimString(source.imapMailbox) ?? EMAIL_CHANNEL_CONFIG_DEFAULTS.imapMailbox,
    smtpHost: trimString(source.smtpHost) ?? DEFAULT_SMTP_HOST,
    smtpPort: parsePort(source.smtpPort, DEFAULT_SMTP_PORT),
    smtpSecure: parseBoolean(source.smtpSecure, EMAIL_CHANNEL_CONFIG_DEFAULTS.smtpSecure),
    pollIntervalMs: parsePollIntervalMs(source.pollIntervalMs),
    allowlist,
    globalAllowlist,
    ...(credentialRef ? { credentialRef } : {}),
    credentialConfigured: source.credentialConfigured === true || Boolean(credentialRef),
  }
}

export async function prepareEmailChannelConfigForStorage(input: {
  commanderId: string
  accountId: string
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  deferCredentialWrite?: boolean
}): Promise<PreparedEmailChannelConfig> {
  const incoming = isObject(input.incomingConfig) ? input.incomingConfig : {}
  const existingConfig = stripEmailCredentialInputs(input.existingConfig ?? {})
  const incomingConfig = stripEmailCredentialInputs({ ...incoming } as CommanderChannelBindingConfig)
  delete incomingConfig.credentialRef
  delete incomingConfig.credentialConfigured
  const existing = parseEmailChannelConfig(existingConfig, input.accountId)
  const incomingPassword =
    trimString(incoming.appPassword)
    ?? trimString(incoming.password)
    ?? trimString(incoming.credential)
  const credentialRef = incomingPassword
    ? emailCredentialRef(input.accountId)
    : existing.credentialRef
  const commitCredential = incomingPassword && credentialRef
    ? () => input.secretsStore.setSecret(input.commanderId, credentialRef, incomingPassword)
    : undefined
  if (commitCredential && !input.deferCredentialWrite) {
    await commitCredential()
  }

  const merged = stripEmailCredentialInputs({
    ...existingConfig,
    ...incomingConfig,
    provider: 'email',
    ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
  } as CommanderChannelBindingConfig)
  const next = parseEmailChannelConfig(merged, input.accountId)
  const dmPolicy = typeof merged.dmPolicy === 'string'
    ? merged.dmPolicy
    : EMAIL_CHANNEL_CONFIG_DEFAULTS.dmPolicy
  const groupPolicy = typeof merged.groupPolicy === 'string'
    ? merged.groupPolicy
    : EMAIL_CHANNEL_CONFIG_DEFAULTS.groupPolicy

  return {
    credentialUpdated: Boolean(incomingPassword),
    ...(commitCredential ? { commitCredential } : {}),
    config: {
      provider: 'email',
      username: next.username,
      fromAddress: next.fromAddress,
      ...(next.replyFromAddress ? { replyFromAddress: next.replyFromAddress } : {}),
      ...(next.emailAlias ? { emailAlias: next.emailAlias } : {}),
      ...(next.defaultCommanderId ? { defaultCommanderId: next.defaultCommanderId } : {}),
      imapHost: next.imapHost,
      imapPort: next.imapPort,
      imapSecure: next.imapSecure,
      imapMailbox: next.imapMailbox,
      smtpHost: next.smtpHost,
      smtpPort: next.smtpPort,
      smtpSecure: next.smtpSecure,
      pollIntervalMs: next.pollIntervalMs,
      allowlist: next.allowlist,
      globalAllowlist: next.globalAllowlist,
      dmPolicy,
      groupPolicy,
      ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
    },
  }
}

export function stripEmailCredentialInputs(config: CommanderChannelBindingConfig): CommanderChannelBindingConfig {
  const next = { ...config }
  delete next.appPassword
  delete next.password
  delete next.credential
  return next
}
