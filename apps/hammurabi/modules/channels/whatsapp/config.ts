import { createHash } from 'node:crypto'
import path from 'node:path'
import type { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import { WHATSAPP_CHANNEL_CONFIG_DEFAULTS } from '../descriptors.js'
import { CommanderChannelValidationError } from '../store.js'
import type {
  CommanderChannelBindingConfig,
  ChannelPolicyMode,
} from '../types.js'

export type WhatsAppTransportKind = 'baileys' | 'cloud'

export interface WhatsAppBaileysConfig {
  authStateDir?: string
  browserName: string
  connectTimeoutMs: number
  printQrInTerminal: boolean
  markOnlineOnConnect: boolean
  syncFullHistory: boolean
  reconnect: boolean
  sendTextWithVoiceNote: boolean
}

export interface WhatsAppCloudConfig {
  phoneNumberId?: string
  verifyToken?: string
  accessTokenRef?: string
  accessTokenConfigured: boolean
}

export interface WhatsAppChannelConfig extends CommanderChannelBindingConfig {
  provider: 'whatsapp'
  transport: WhatsAppTransportKind
  displayLabel?: string
  baileys: WhatsAppBaileysConfig
  cloud: WhatsAppCloudConfig
  dmPolicy: ChannelPolicyMode
  groupPolicy: ChannelPolicyMode
  dmAllowlist: string[]
  groupAllowlist: string[]
  allowlist: string[]
  globalAllowlist: string[]
  requireMention: boolean
  tts: {
    enabled: boolean
    voice: string
  }
  stt: {
    enabled: boolean
  }
}

export interface PreparedWhatsAppChannelConfig {
  config: CommanderChannelBindingConfig
  credentialUpdated: boolean
  commitCredential?: () => Promise<void>
}

const POLICY_VALUES = new Set<ChannelPolicyMode>(['open', 'allowlist', 'disabled'])
const TRANSPORT_VALUES = new Set<WhatsAppTransportKind>(['baileys', 'cloud'])
const DEFAULT_BAILEYS = WHATSAPP_CHANNEL_CONFIG_DEFAULTS.baileys
const DEFAULT_BAILEYS_CONNECT_TIMEOUT_MS = WHATSAPP_CHANNEL_CONFIG_DEFAULTS.baileys.connectTimeoutMs
const DEFAULT_BAILEYS_BROWSER_NAME = WHATSAPP_CHANNEL_CONFIG_DEFAULTS.baileys.browserName

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
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

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' && value.trim()
    ? Number(value.trim())
    : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback
  }
  const normalized = Math.trunc(raw)
  return normalized > 0 ? normalized : fallback
}

function parsePolicy(value: unknown, fallback: ChannelPolicyMode): ChannelPolicyMode {
  return typeof value === 'string' && POLICY_VALUES.has(value as ChannelPolicyMode)
    ? value as ChannelPolicyMode
    : fallback
}

function parseTransport(value: unknown): WhatsAppTransportKind {
  return typeof value === 'string' && TRANSPORT_VALUES.has(value as WhatsAppTransportKind)
    ? value as WhatsAppTransportKind
    : 'baileys'
}

function hashPathToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

function whatsappAccountDataRoot(accountId: string, dataDir?: string): string | undefined {
  return dataDir
    ? path.join(path.resolve(dataDir), 'channels', 'whatsapp', hashPathToken(accountId.trim().toLowerCase()))
    : undefined
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeAuthStateDir(value: unknown, accountRoot: string | undefined): string | undefined {
  const raw = trimString(value)
  if (!raw) {
    return undefined
  }
  if (!accountRoot) {
    return path.resolve(raw)
  }
  const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(accountRoot, raw))
  if (!isPathInside(accountRoot, resolved)) {
    throw new CommanderChannelValidationError('baileys.authStateDir must stay within the WhatsApp account data directory')
  }
  return resolved
}

export function whatsappAccessTokenRef(accountId: string): string {
  return `whatsapp:${accountId.trim().toLowerCase()}:cloud-access-token`
}

export function parseWhatsAppChannelConfig(
  raw: unknown,
  accountId: string,
  dataDir?: string,
): WhatsAppChannelConfig {
  const source = isObject(raw) ? raw : {}
  const baileysSource = isObject(source.baileys) ? source.baileys : {}
  const cloudSource = isObject(source.cloud) ? source.cloud : {}
  const accountRoot = whatsappAccountDataRoot(accountId, dataDir)
  const defaultAuthStateDir = accountRoot ? path.join(accountRoot, 'auth') : undefined
  const authStateDir = normalizeAuthStateDir(baileysSource.authStateDir ?? source.authStateDir, accountRoot)
    ?? defaultAuthStateDir

  return {
    provider: 'whatsapp',
    transport: parseTransport(source.transport),
    ...(trimString(source.displayLabel) ? { displayLabel: trimString(source.displayLabel) } : {}),
    baileys: {
      ...(authStateDir ? { authStateDir } : {}),
      browserName: trimString(baileysSource.browserName ?? source.browserName) ?? DEFAULT_BAILEYS_BROWSER_NAME,
      connectTimeoutMs: parsePositiveInteger(
        baileysSource.connectTimeoutMs ?? source.connectTimeoutMs,
        DEFAULT_BAILEYS_CONNECT_TIMEOUT_MS,
      ),
      printQrInTerminal: parseBoolean(
        baileysSource.printQrInTerminal ?? source.printQrInTerminal,
        DEFAULT_BAILEYS.printQrInTerminal,
      ),
      markOnlineOnConnect: parseBoolean(
        baileysSource.markOnlineOnConnect ?? source.markOnlineOnConnect,
        DEFAULT_BAILEYS.markOnlineOnConnect,
      ),
      syncFullHistory: parseBoolean(
        baileysSource.syncFullHistory ?? source.syncFullHistory,
        DEFAULT_BAILEYS.syncFullHistory,
      ),
      reconnect: parseBoolean(baileysSource.reconnect ?? source.reconnect, DEFAULT_BAILEYS.reconnect),
      sendTextWithVoiceNote: parseBoolean(
        baileysSource.sendTextWithVoiceNote ?? source.sendTextWithVoiceNote,
        DEFAULT_BAILEYS.sendTextWithVoiceNote,
      ),
    },
    cloud: {
      ...(trimString(cloudSource.phoneNumberId ?? source.phoneNumberId)
        ? { phoneNumberId: trimString(cloudSource.phoneNumberId ?? source.phoneNumberId) }
        : {}),
      ...(trimString(cloudSource.verifyToken ?? source.verifyToken)
        ? { verifyToken: trimString(cloudSource.verifyToken ?? source.verifyToken) }
        : {}),
      ...(trimString(cloudSource.accessTokenRef ?? source.accessTokenRef)
        ? { accessTokenRef: trimString(cloudSource.accessTokenRef ?? source.accessTokenRef) }
        : {}),
      accessTokenConfigured: source.accessTokenConfigured === true || cloudSource.accessTokenConfigured === true,
    },
    dmPolicy: parsePolicy(source.dmPolicy, WHATSAPP_CHANNEL_CONFIG_DEFAULTS.dmPolicy),
    groupPolicy: parsePolicy(source.groupPolicy, WHATSAPP_CHANNEL_CONFIG_DEFAULTS.groupPolicy),
    dmAllowlist: parseStringList(source.dmAllowlist),
    groupAllowlist: parseStringList(source.groupAllowlist),
    allowlist: parseStringList(source.allowlist),
    globalAllowlist: parseStringList(source.globalAllowlist),
    requireMention: parseBoolean(source.requireMention, WHATSAPP_CHANNEL_CONFIG_DEFAULTS.requireMention),
    tts: {
      enabled: parseBoolean(isObject(source.tts) ? source.tts.enabled : undefined, WHATSAPP_CHANNEL_CONFIG_DEFAULTS.tts.enabled),
      voice: trimString(isObject(source.tts) ? source.tts.voice : undefined) ?? WHATSAPP_CHANNEL_CONFIG_DEFAULTS.tts.voice,
    },
    stt: {
      enabled: parseBoolean(isObject(source.stt) ? source.stt.enabled : undefined, WHATSAPP_CHANNEL_CONFIG_DEFAULTS.stt.enabled),
    },
  }
}

export async function prepareWhatsAppChannelConfigForStorage(input: {
  commanderId: string
  accountId: string
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  dataDir?: string
  deferCredentialWrite?: boolean
}): Promise<PreparedWhatsAppChannelConfig> {
  const incoming = isObject(input.incomingConfig) ? input.incomingConfig : {}
  const existing = parseWhatsAppChannelConfig(input.existingConfig, input.accountId, input.dataDir)
  const incomingCloud = isObject(incoming.cloud) ? incoming.cloud : {}
  const incomingAccessToken = trimString(incomingCloud.accessToken ?? incoming.accessToken)
  const accessTokenRef = incomingAccessToken
    ? whatsappAccessTokenRef(input.accountId)
    : existing.cloud.accessTokenRef
  const commitCredential = incomingAccessToken && accessTokenRef
    ? () => input.secretsStore.setSecret(input.commanderId, accessTokenRef, incomingAccessToken)
    : undefined
  if (commitCredential && !input.deferCredentialWrite) {
    await commitCredential()
  }

  const merged: Record<string, unknown> & { cloud?: Record<string, unknown> } = {
    ...input.existingConfig,
    ...incoming,
    cloud: {
      ...(isObject(input.existingConfig?.cloud) ? input.existingConfig.cloud : {}),
      ...(isObject(incoming.cloud) ? incoming.cloud : {}),
      ...(accessTokenRef ? { accessTokenRef, accessTokenConfigured: true } : {}),
    },
  }
  delete merged.accessToken
  if (isObject(merged.cloud)) {
    delete merged.cloud.accessToken
  }

  const parsed = parseWhatsAppChannelConfig(merged, input.accountId, input.dataDir)
  return {
    credentialUpdated: Boolean(incomingAccessToken),
    ...(commitCredential ? { commitCredential } : {}),
    config: {
      provider: 'whatsapp',
      transport: parsed.transport,
      ...(parsed.displayLabel ? { displayLabel: parsed.displayLabel } : {}),
      baileys: {
        ...(parsed.baileys.authStateDir ? { authStateDir: parsed.baileys.authStateDir } : {}),
        browserName: parsed.baileys.browserName,
        connectTimeoutMs: parsed.baileys.connectTimeoutMs,
        printQrInTerminal: parsed.baileys.printQrInTerminal,
        markOnlineOnConnect: parsed.baileys.markOnlineOnConnect,
        syncFullHistory: parsed.baileys.syncFullHistory,
        reconnect: parsed.baileys.reconnect,
        sendTextWithVoiceNote: parsed.baileys.sendTextWithVoiceNote,
      },
      cloud: {
        ...(parsed.cloud.phoneNumberId ? { phoneNumberId: parsed.cloud.phoneNumberId } : {}),
        ...(parsed.cloud.verifyToken ? { verifyToken: parsed.cloud.verifyToken } : {}),
        ...(parsed.cloud.accessTokenRef ? { accessTokenRef: parsed.cloud.accessTokenRef } : {}),
        accessTokenConfigured: parsed.cloud.accessTokenConfigured || Boolean(parsed.cloud.accessTokenRef),
      },
      dmPolicy: parsed.dmPolicy,
      groupPolicy: parsed.groupPolicy,
      dmAllowlist: parsed.dmAllowlist,
      groupAllowlist: parsed.groupAllowlist,
      allowlist: parsed.allowlist,
      globalAllowlist: parsed.globalAllowlist,
      requireMention: parsed.requireMention,
      tts: parsed.tts,
      stt: parsed.stt,
    },
  }
}
