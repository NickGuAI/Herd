import { createHash } from 'node:crypto'
import type { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import { SLACK_CHANNEL_CONFIG_DEFAULTS } from '../descriptors.js'
import type { ChannelPolicyMode, CommanderChannelBindingConfig } from '../types.js'

const POLICY_VALUES = new Set<ChannelPolicyMode>(['open', 'allowlist', 'disabled'])

export interface SlackChannelConfig extends CommanderChannelBindingConfig {
  provider: 'slack'
  teamId?: string
  appId?: string
  botUserId?: string
  botTokenRef?: string
  appTokenRef?: string
  botTokenConfigured: boolean
  appTokenConfigured: boolean
  credentialConfigured: boolean
  dmPolicy: ChannelPolicyMode
  groupPolicy: ChannelPolicyMode
  dmAllowlist: string[]
  groupAllowlist: string[]
  allowlist: string[]
  globalAllowlist: string[]
  requireMention: boolean
  maxMessageLength: number
}

export interface PreparedSlackChannelConfig {
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

export function slackBotTokenRef(accountId: string): string {
  const digest = createHash('sha256')
    .update(normalizeAccountToken(accountId))
    .digest('hex')
    .slice(0, 20)
  return `slack:${digest}:bot-token`
}

export function slackAppTokenRef(accountId: string): string {
  const digest = createHash('sha256')
    .update(normalizeAccountToken(accountId))
    .digest('hex')
    .slice(0, 20)
  return `slack:${digest}:app-token`
}

export function parseSlackChannelConfig(raw: unknown, accountId: string): SlackChannelConfig {
  const source = isObject(raw) ? raw : {}
  const botTokenRef = trimString(source.botTokenRef) ?? trimString(source.credentialRef)
  const appTokenRef = trimString(source.appTokenRef)
  const botTokenConfigured = source.botTokenConfigured === true || Boolean(botTokenRef)
  const appTokenConfigured = source.appTokenConfigured === true || Boolean(appTokenRef)

  return {
    provider: 'slack',
    ...(trimString(source.teamId) ? { teamId: trimString(source.teamId) } : {}),
    ...(trimString(source.appId) ? { appId: trimString(source.appId) } : {}),
    ...(trimString(source.botUserId) ? { botUserId: trimString(source.botUserId) } : {}),
    ...(botTokenRef ? { botTokenRef } : {}),
    ...(appTokenRef ? { appTokenRef } : {}),
    botTokenConfigured,
    appTokenConfigured,
    credentialConfigured: source.credentialConfigured === true || (botTokenConfigured && appTokenConfigured),
    dmPolicy: parsePolicy(source.dmPolicy, SLACK_CHANNEL_CONFIG_DEFAULTS.dmPolicy),
    groupPolicy: parsePolicy(source.groupPolicy, SLACK_CHANNEL_CONFIG_DEFAULTS.groupPolicy),
    dmAllowlist: parseStringList(source.dmAllowlist),
    groupAllowlist: parseStringList(source.groupAllowlist),
    allowlist: parseStringList(source.allowlist),
    globalAllowlist: parseStringList(source.globalAllowlist),
    requireMention: parseBoolean(source.requireMention, SLACK_CHANNEL_CONFIG_DEFAULTS.requireMention),
    maxMessageLength: parseNumber(
      source.maxMessageLength,
      SLACK_CHANNEL_CONFIG_DEFAULTS.maxMessageLength,
      512,
      40_000,
    ),
    accountId,
  }
}

export async function prepareSlackChannelConfigForStorage(input: {
  commanderId: string
  accountId: string
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  deferCredentialWrite?: boolean
}): Promise<PreparedSlackChannelConfig> {
  const incoming = isObject(input.incomingConfig) ? input.incomingConfig : {}
  const existingConfig = stripSlackCredentialInputs(input.existingConfig ?? {})
  const incomingConfig = stripSlackCredentialInputs({ ...incoming } as CommanderChannelBindingConfig)
  delete incomingConfig.credentialRef
  delete incomingConfig.botTokenRef
  delete incomingConfig.appTokenRef
  delete incomingConfig.botTokenConfigured
  delete incomingConfig.appTokenConfigured
  delete incomingConfig.credentialConfigured

  const existing = parseSlackChannelConfig(existingConfig, input.accountId)
  const incomingBotToken =
    trimString(incoming.botToken)
    ?? trimString(incoming.token)
    ?? trimString(incoming.credential)
  const incomingAppToken =
    trimString(incoming.appToken)
    ?? trimString(incoming.socketModeToken)
  const botTokenRef = incomingBotToken ? slackBotTokenRef(input.accountId) : existing.botTokenRef
  const appTokenRef = incomingAppToken ? slackAppTokenRef(input.accountId) : existing.appTokenRef

  const commitCredential = async () => {
    if (incomingBotToken && botTokenRef) {
      await input.secretsStore.setSecret(input.commanderId, botTokenRef, incomingBotToken)
    }
    if (incomingAppToken && appTokenRef) {
      await input.secretsStore.setSecret(input.commanderId, appTokenRef, incomingAppToken)
    }
  }
  const credentialUpdated = Boolean(incomingBotToken || incomingAppToken)
  if (credentialUpdated && !input.deferCredentialWrite) {
    await commitCredential()
  }

  const merged = stripSlackCredentialInputs({
    ...existingConfig,
    ...incomingConfig,
    provider: 'slack',
    ...(botTokenRef ? { botTokenRef, botTokenConfigured: true } : { botTokenConfigured: false }),
    ...(appTokenRef ? { appTokenRef, appTokenConfigured: true } : { appTokenConfigured: false }),
    credentialConfigured: Boolean(botTokenRef && appTokenRef),
  } as CommanderChannelBindingConfig)
  const parsed = parseSlackChannelConfig(merged, input.accountId)

  return {
    credentialUpdated,
    ...(credentialUpdated ? { commitCredential } : {}),
    config: {
      provider: 'slack',
      ...(parsed.teamId ? { teamId: parsed.teamId } : {}),
      ...(parsed.appId ? { appId: parsed.appId } : {}),
      ...(parsed.botUserId ? { botUserId: parsed.botUserId } : {}),
      dmPolicy: parsed.dmPolicy,
      groupPolicy: parsed.groupPolicy,
      dmAllowlist: parsed.dmAllowlist,
      groupAllowlist: parsed.groupAllowlist,
      allowlist: parsed.allowlist,
      globalAllowlist: parsed.globalAllowlist,
      requireMention: parsed.requireMention,
      maxMessageLength: parsed.maxMessageLength,
      ...(botTokenRef ? { botTokenRef, botTokenConfigured: true } : { botTokenConfigured: false }),
      ...(appTokenRef ? { appTokenRef, appTokenConfigured: true } : { appTokenConfigured: false }),
      credentialConfigured: Boolean(botTokenRef && appTokenRef),
    },
  }
}

export function stripSlackCredentialInputs(config: CommanderChannelBindingConfig): CommanderChannelBindingConfig {
  const next = { ...config }
  delete next.botToken
  delete next.appToken
  delete next.socketModeToken
  delete next.token
  delete next.credential
  return next
}
