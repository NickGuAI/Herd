import { createHash } from 'node:crypto'
import type { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import { DISCORD_CHANNEL_CONFIG_DEFAULTS } from '../descriptors.js'
import type { ChannelPolicyMode, CommanderChannelBindingConfig } from '../types.js'

const POLICY_VALUES = new Set<ChannelPolicyMode>(['open', 'allowlist', 'disabled'])

export interface DiscordChannelConfig extends CommanderChannelBindingConfig {
  provider: 'discord'
  applicationId?: string
  botUserId?: string
  credentialRef?: string
  credentialConfigured: boolean
  dmPolicy: ChannelPolicyMode
  groupPolicy: ChannelPolicyMode
  dmAllowlist: string[]
  groupAllowlist: string[]
  allowlist: string[]
  globalAllowlist: string[]
  requireMention: boolean
  gatewayIntents: number
  maxMessageLength: number
}

export interface PreparedDiscordChannelConfig {
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

export function discordCredentialRef(accountId: string): string {
  const digest = createHash('sha256')
    .update(normalizeAccountToken(accountId))
    .digest('hex')
    .slice(0, 20)
  return `discord:${digest}:bot-token`
}

export function parseDiscordChannelConfig(raw: unknown, accountId: string): DiscordChannelConfig {
  const source = isObject(raw) ? raw : {}
  const credentialRef = trimString(source.credentialRef)

  return {
    provider: 'discord',
    ...(trimString(source.applicationId) ? { applicationId: trimString(source.applicationId) } : {}),
    ...(trimString(source.botUserId) ? { botUserId: trimString(source.botUserId) } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    credentialConfigured: source.credentialConfigured === true || Boolean(credentialRef),
    dmPolicy: parsePolicy(source.dmPolicy, DISCORD_CHANNEL_CONFIG_DEFAULTS.dmPolicy),
    groupPolicy: parsePolicy(source.groupPolicy, DISCORD_CHANNEL_CONFIG_DEFAULTS.groupPolicy),
    dmAllowlist: parseStringList(source.dmAllowlist),
    groupAllowlist: parseStringList(source.groupAllowlist),
    allowlist: parseStringList(source.allowlist),
    globalAllowlist: parseStringList(source.globalAllowlist),
    requireMention: parseBoolean(source.requireMention, DISCORD_CHANNEL_CONFIG_DEFAULTS.requireMention),
    gatewayIntents: parseNumber(
      source.gatewayIntents,
      DISCORD_CHANNEL_CONFIG_DEFAULTS.gatewayIntents,
      1,
      131_071,
    ),
    maxMessageLength: parseNumber(
      source.maxMessageLength,
      DISCORD_CHANNEL_CONFIG_DEFAULTS.maxMessageLength,
      512,
      2_000,
    ),
    accountId,
  }
}

export async function prepareDiscordChannelConfigForStorage(input: {
  commanderId: string
  accountId: string
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  deferCredentialWrite?: boolean
}): Promise<PreparedDiscordChannelConfig> {
  const incoming = isObject(input.incomingConfig) ? input.incomingConfig : {}
  const existingConfig = stripDiscordCredentialInputs(input.existingConfig ?? {})
  const incomingConfig = stripDiscordCredentialInputs({ ...incoming } as CommanderChannelBindingConfig)
  delete incomingConfig.credentialRef
  delete incomingConfig.credentialConfigured

  const existing = parseDiscordChannelConfig(existingConfig, input.accountId)
  const incomingToken =
    trimString(incoming.botToken)
    ?? trimString(incoming.token)
    ?? trimString(incoming.credential)
  const credentialRef = incomingToken ? discordCredentialRef(input.accountId) : existing.credentialRef
  const commitCredential = incomingToken && credentialRef
    ? () => input.secretsStore.setSecret(input.commanderId, credentialRef, incomingToken)
    : undefined
  if (commitCredential && !input.deferCredentialWrite) {
    await commitCredential()
  }

  const merged = stripDiscordCredentialInputs({
    ...existingConfig,
    ...incomingConfig,
    provider: 'discord',
    ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
  } as CommanderChannelBindingConfig)
  const parsed = parseDiscordChannelConfig(merged, input.accountId)

  return {
    credentialUpdated: Boolean(incomingToken),
    ...(commitCredential ? { commitCredential } : {}),
    config: {
      provider: 'discord',
      ...(parsed.applicationId ? { applicationId: parsed.applicationId } : {}),
      ...(parsed.botUserId ? { botUserId: parsed.botUserId } : {}),
      dmPolicy: parsed.dmPolicy,
      groupPolicy: parsed.groupPolicy,
      dmAllowlist: parsed.dmAllowlist,
      groupAllowlist: parsed.groupAllowlist,
      allowlist: parsed.allowlist,
      globalAllowlist: parsed.globalAllowlist,
      requireMention: parsed.requireMention,
      gatewayIntents: parsed.gatewayIntents,
      maxMessageLength: parsed.maxMessageLength,
      ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
    },
  }
}

export function stripDiscordCredentialInputs(config: CommanderChannelBindingConfig): CommanderChannelBindingConfig {
  const next = { ...config }
  delete next.botToken
  delete next.token
  delete next.credential
  return next
}
