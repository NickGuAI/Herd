import { createHash } from 'node:crypto'
import type { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import { TELEGRAM_CHANNEL_CONFIG_DEFAULTS } from '../descriptors.js'
import type { ChannelPolicyMode, CommanderChannelBindingConfig } from '../types.js'

const POLICY_VALUES = new Set<ChannelPolicyMode>(['open', 'allowlist', 'disabled'])

export interface TelegramChannelConfig extends CommanderChannelBindingConfig {
  provider: 'telegram'
  botUsername?: string
  credentialRef?: string
  credentialConfigured: boolean
  dmPolicy: ChannelPolicyMode
  groupPolicy: ChannelPolicyMode
  dmAllowlist: string[]
  groupAllowlist: string[]
  allowlist: string[]
  globalAllowlist: string[]
  requireMention: boolean
  pollIntervalMs: number
  longPollTimeoutSeconds: number
  maxMessageLength: number
}

export interface PreparedTelegramChannelConfig {
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

function parseNumber(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'string' && value.trim() ? Number(value.trim()) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback
  }
  const normalized = Math.trunc(raw)
  return Math.min(Math.max(normalized, min), max)
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

function parsePolicy(value: unknown, fallback: ChannelPolicyMode): ChannelPolicyMode {
  return typeof value === 'string' && POLICY_VALUES.has(value as ChannelPolicyMode)
    ? value as ChannelPolicyMode
    : fallback
}

function normalizeAccountToken(accountId: string): string {
  return accountId.trim().toLowerCase()
}

export function telegramCredentialRef(accountId: string): string {
  const digest = createHash('sha256')
    .update(normalizeAccountToken(accountId))
    .digest('hex')
    .slice(0, 20)
  return `telegram:${digest}:bot-token`
}

export function parseTelegramChannelConfig(raw: unknown, accountId: string): TelegramChannelConfig {
  const source = isObject(raw) ? raw : {}
  const credentialRef = trimString(source.credentialRef)
  const pollIntervalMs = parseNumber(
    source.pollIntervalMs,
    TELEGRAM_CHANNEL_CONFIG_DEFAULTS.pollIntervalMs,
    1_000,
    60_000,
  )
  const longPollTimeoutSeconds = parseNumber(
    source.longPollTimeoutSeconds,
    TELEGRAM_CHANNEL_CONFIG_DEFAULTS.longPollTimeoutSeconds,
    1,
    50,
  )
  const maxMessageLength = parseNumber(
    source.maxMessageLength,
    TELEGRAM_CHANNEL_CONFIG_DEFAULTS.maxMessageLength,
    512,
    4_096,
  )

  return {
    provider: 'telegram',
    ...(trimString(source.botUsername) ? { botUsername: trimString(source.botUsername) } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    credentialConfigured: source.credentialConfigured === true || Boolean(credentialRef),
    dmPolicy: parsePolicy(source.dmPolicy, TELEGRAM_CHANNEL_CONFIG_DEFAULTS.dmPolicy),
    groupPolicy: parsePolicy(source.groupPolicy, TELEGRAM_CHANNEL_CONFIG_DEFAULTS.groupPolicy),
    dmAllowlist: parseStringList(source.dmAllowlist),
    groupAllowlist: parseStringList(source.groupAllowlist),
    allowlist: parseStringList(source.allowlist),
    globalAllowlist: parseStringList(source.globalAllowlist),
    requireMention: parseBoolean(source.requireMention, TELEGRAM_CHANNEL_CONFIG_DEFAULTS.requireMention),
    pollIntervalMs,
    longPollTimeoutSeconds,
    maxMessageLength,
    accountId,
  }
}

export async function prepareTelegramChannelConfigForStorage(input: {
  commanderId: string
  accountId: string
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  deferCredentialWrite?: boolean
}): Promise<PreparedTelegramChannelConfig> {
  const incoming = isObject(input.incomingConfig) ? input.incomingConfig : {}
  const existingConfig = stripTelegramCredentialInputs(input.existingConfig ?? {})
  const incomingConfig = stripTelegramCredentialInputs({ ...incoming } as CommanderChannelBindingConfig)
  delete incomingConfig.credentialRef
  delete incomingConfig.credentialConfigured

  const existing = parseTelegramChannelConfig(existingConfig, input.accountId)
  const incomingToken =
    trimString(incoming.botToken)
    ?? trimString(incoming.token)
    ?? trimString(incoming.credential)
  const credentialRef = incomingToken ? telegramCredentialRef(input.accountId) : existing.credentialRef
  const commitCredential = incomingToken && credentialRef
    ? () => input.secretsStore.setSecret(input.commanderId, credentialRef, incomingToken)
    : undefined
  if (commitCredential && !input.deferCredentialWrite) {
    await commitCredential()
  }

  const merged = stripTelegramCredentialInputs({
    ...existingConfig,
    ...incomingConfig,
    provider: 'telegram',
    ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
  } as CommanderChannelBindingConfig)
  const parsed = parseTelegramChannelConfig(merged, input.accountId)

  return {
    credentialUpdated: Boolean(incomingToken),
    ...(commitCredential ? { commitCredential } : {}),
      config: {
        provider: 'telegram',
        ...(parsed.botUsername ? { botUsername: parsed.botUsername } : {}),
        dmPolicy: parsed.dmPolicy,
      groupPolicy: parsed.groupPolicy,
      dmAllowlist: parsed.dmAllowlist,
      groupAllowlist: parsed.groupAllowlist,
      allowlist: parsed.allowlist,
      globalAllowlist: parsed.globalAllowlist,
      requireMention: parsed.requireMention,
      pollIntervalMs: parsed.pollIntervalMs,
      longPollTimeoutSeconds: parsed.longPollTimeoutSeconds,
      maxMessageLength: parsed.maxMessageLength,
      ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
    },
  }
}

export function stripTelegramCredentialInputs(config: CommanderChannelBindingConfig): CommanderChannelBindingConfig {
  const next = { ...config }
  delete next.botToken
  delete next.token
  delete next.credential
  return next
}
