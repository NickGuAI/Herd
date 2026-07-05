import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { checkAccountInboundPolicy } from '../policy.js'
import { effectiveBindingCommanderId } from '../binding-routing.js'
import type { CommanderChannelBindingStore } from '../store.js'
import type {
  ChannelAdapter,
  ChannelInboundDecision,
  ChannelInboundEvent,
  ChannelOutboundPayload,
  ChannelRuntime,
  CommanderChannelBinding,
} from '../types.js'
import { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import type { Conversation } from '../../commanders/conversation-store.js'
import { parseEmailChannelConfig, type EmailChannelConfig } from './config.js'
import { checkEmailInboundFilter } from './filters.js'
import {
  extractEmailAddress,
  normalizeEmailAlias,
  parsePlusAliasFromRecipients,
} from './plus-address.js'

interface AddressLike {
  address?: string
  name?: string
}

interface AddressFieldLike {
  text?: string
  value?: AddressLike[]
}

interface ParsedAttachmentLike {
  filename?: string
  contentType?: string
  content?: Buffer
}

interface ParsedMailLike {
  from?: AddressFieldLike
  to?: AddressFieldLike | AddressFieldLike[]
  cc?: AddressFieldLike | AddressFieldLike[]
  subject?: string
  messageId?: string
  inReplyTo?: string
  references?: string | string[]
  text?: string
  html?: string | false
  date?: Date
  headers?: Map<string, unknown>
  attachments?: ParsedAttachmentLike[]
}

interface ImapLockLike {
  release(): void
}

interface ImapFetchMessageLike {
  uid?: number | string
  seq?: number | string
  source?: Buffer
  envelope?: {
    messageId?: string
  }
}

interface ImapClientLike {
  connect(): Promise<void>
  logout(): Promise<void>
  getMailboxLock(mailbox: string): Promise<ImapLockLike>
  search(query: Record<string, unknown>): Promise<unknown>
  fetch(range: unknown, query: Record<string, unknown>): AsyncIterable<ImapFetchMessageLike>
  messageFlagsAdd(range: unknown, flags: readonly string[], options: Record<string, unknown>): Promise<unknown>
}

interface EmailRuntime extends ChannelRuntime<EmailChannelConfig> {
  stopped: boolean
  polling: boolean
  initialTimer?: NodeJS.Timeout
  timer?: NodeJS.Timeout
  imapClient?: ImapClientLike
}

interface EmailChannelMessagePayload {
  provider: 'email'
  accountId: string
  chatType: 'direct'
  peerId: string
  displayName: string
  message: string
  mode: 'followup'
  commanderId?: string
  subject?: string
  threadId?: string
  rawTimestamp: string
  rawSourceId: string
}

export interface EmailChannelAdapterOptions {
  bindingStore: CommanderChannelBindingStore
  secretsStore?: CommanderSecretsStore
  apiBaseUrl?: string
  internalToken: string
  dataDir: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  logger?: Pick<Console, 'error' | 'warn' | 'log'>
}

function resolveApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.HERD_API_BASE_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/u, '')
  }
  const port = env.PORT?.trim() || '20001'
  return `http://127.0.0.1:${port}`
}

function normalizeMessageId(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) {
    return undefined
  }
  return normalized.startsWith('<') ? normalized : `<${normalized}>`
}

function normalizeReferences(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }
  const raw = Array.isArray(value) ? value.join(' ') : value
  return raw
    .split(/\s+/u)
    .map((entry) => normalizeMessageId(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function firstAddress(field: AddressFieldLike | undefined): string | null {
  const fromValue = field?.value?.find((entry) => entry.address?.trim())
  if (fromValue?.address) {
    return fromValue.address.toLowerCase()
  }
  return extractEmailAddress(field?.text ?? '')
}

function addressList(field: AddressFieldLike | AddressFieldLike[] | undefined): string[] {
  const fields = Array.isArray(field) ? field : field ? [field] : []
  const addresses: string[] = []
  for (const entry of fields) {
    for (const value of entry.value ?? []) {
      if (value.address?.trim()) {
        addresses.push(value.address.trim().toLowerCase())
      }
    }
    if (entry.text) {
      const textAddress = extractEmailAddress(entry.text)
      if (textAddress) {
        addresses.push(textAddress)
      }
    }
  }
  return [...new Set(addresses)]
}

function headerValue(headers: Map<string, unknown> | undefined, name: string): string | undefined {
  const value = headers?.get(name.toLowerCase())
  return typeof value === 'string' ? value : undefined
}

function textFromParsedMail(parsed: ParsedMailLike): string {
  const text = parsed.text?.trim()
  if (text) {
    return text
  }
  const html = typeof parsed.html === 'string' ? parsed.html : ''
  return html
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p>/giu, '\n\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function safeFileName(input: string | undefined, fallback: string): string {
  const normalized = (input ?? fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized || fallback
}

function hashPathToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function normalizeSubject(value: string | undefined): string {
  return value?.trim() || '(no subject)'
}

function replySubject(subject: string | undefined): string {
  const normalized = normalizeSubject(subject)
  return /^re:/iu.test(normalized) ? normalized : `Re: ${normalized}`
}

function extractMediaDirectives(text: string): {
  text: string
  attachments: Array<{ path: string }>
} {
  const attachments: Array<{ path: string }> = []
  const lines: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('MEDIA:')) {
      const filePath = trimmed.slice('MEDIA:'.length).trim()
      if (filePath) {
        attachments.push({ path: filePath })
      }
      continue
    }
    lines.push(line)
  }
  return {
    text: lines.join('\n').trim(),
    attachments,
  }
}

export class EmailChannelAdapter implements ChannelAdapter<EmailChannelConfig> {
  readonly provider = 'email' as const
  readonly capabilities = {
    voiceNotes: false,
    media: true,
    threading: true,
    typingIndicators: false,
    presence: false,
    reactions: false,
    supportsMessageEdit: false,
    markdownDialect: 'plain' as const,
  }

  private readonly bindingStore: CommanderChannelBindingStore
  private readonly secretsStore: CommanderSecretsStore
  private readonly apiBaseUrl: string
  private readonly internalToken: string
  private readonly dataDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly fetchImpl: typeof fetch
  private readonly logger: Pick<Console, 'error' | 'warn' | 'log'>

  constructor(options: EmailChannelAdapterOptions) {
    this.bindingStore = options.bindingStore
    this.secretsStore = options.secretsStore ?? new CommanderSecretsStore()
    this.env = options.env ?? process.env
    this.apiBaseUrl = (options.apiBaseUrl ?? resolveApiBaseUrl(this.env)).replace(/\/+$/u, '')
    this.internalToken = options.internalToken
    this.dataDir = path.resolve(options.dataDir)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.logger = options.logger ?? console
  }

  normalizeInbound(payload: unknown): ChannelInboundEvent {
    const parsed = payload as EmailChannelMessagePayload
    return {
      provider: 'email',
      accountId: parsed.accountId,
      chatType: 'direct',
      peerId: parsed.peerId,
      peerDisplayName: parsed.displayName,
      ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
      text: parsed.message,
      rawTimestamp: parsed.rawTimestamp,
      rawSourceId: parsed.rawSourceId,
    }
  }

  async start(binding: CommanderChannelBinding): Promise<EmailRuntime> {
    const config = parseEmailChannelConfig(binding.config, binding.accountId)
    if (!config.credentialRef) {
      throw new Error(`Email channel "${binding.displayName}" is missing an encrypted credential`)
    }

    const runtime: EmailRuntime = {
      provider: 'email',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config,
      accountBinding: binding,
      stopped: false,
      polling: false,
    }

    const run = () => {
      void this.pollOnce(runtime).catch((error) => {
        this.logger.error(`[channels/email] IMAP poll failed for ${binding.accountId}:`, error)
      })
    }
    runtime.initialTimer = setTimeout(run, 1_000)
    runtime.initialTimer.unref?.()
    runtime.timer = setInterval(run, config.pollIntervalMs)
    runtime.timer.unref?.()
    return runtime
  }

  async stop(runtime: ChannelRuntime<EmailChannelConfig>): Promise<void> {
    const emailRuntime = runtime as EmailRuntime
    emailRuntime.stopped = true
    if (emailRuntime.initialTimer) {
      clearTimeout(emailRuntime.initialTimer)
      emailRuntime.initialTimer = undefined
    }
    if (emailRuntime.timer) {
      clearInterval(emailRuntime.timer)
      emailRuntime.timer = undefined
    }
    if (emailRuntime.imapClient) {
      await emailRuntime.imapClient.logout().catch(() => undefined)
      emailRuntime.imapClient = undefined
    }
  }

  async beginPairing(input: { provider: 'email'; commanderId: string }): Promise<{
    provider: 'email'
    kind: string
    instructions: string
  }> {
    return {
      provider: 'email',
      kind: 'app-password',
      instructions: `Create an app password for the mailbox, then save it on the channel binding for commander ${input.commanderId}.`,
    }
  }

  async completePairing(): Promise<CommanderChannelBinding> {
    throw new Error('Email pairing is completed by saving the encrypted app password on a channel binding')
  }

  async send(
    runtime: ChannelRuntime<EmailChannelConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ) {
    const binding = await this.resolveBindingForRuntime(runtime, conversation)
    const config = parseEmailChannelConfig(binding.config, binding.accountId)
    if (!config.credentialRef) {
      return { success: false as const, error: 'Email channel credential is not configured' }
    }
    const password = await this.secretsStore.getSecret(binding.commanderId, config.credentialRef)
    if (!password) {
      return { success: false as const, error: 'Email channel credential is missing from the encrypted vault' }
    }

    const recipient = extractEmailAddress(conversation.lastRoute?.to)
    if (!recipient) {
      return { success: false as const, error: 'Email reply recipient is missing' }
    }

    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.username,
        pass: password,
      },
    })
    const text = payload.text?.trim() ?? ''
    const media = extractMediaDirectives(text)
    const subject = replySubject(conversation.channelMeta?.subject)
    const threadId = normalizeMessageId(conversation.channelMeta?.threadId ?? conversation.lastRoute?.threadId)
    const references = normalizeReferences(
      conversation.channelMeta && 'references' in conversation.channelMeta
        ? (conversation.channelMeta as { references?: string[] }).references
        : undefined,
    )
    const allReferences = [...new Set([...references, ...(threadId ? [threadId] : [])])]

    try {
      const response = await transport.sendMail({
        from: config.replyFromAddress ?? config.fromAddress,
        to: recipient,
        subject,
        text: media.text || text,
        ...(threadId ? { inReplyTo: threadId } : {}),
        ...(allReferences.length > 0 ? { references: allReferences } : {}),
        ...(media.attachments.length > 0 ? { attachments: media.attachments } : {}),
      })
      transport.close?.()
      return { success: true as const, rawResponse: response }
    } catch (error) {
      transport.close?.()
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Failed to send email',
      }
    }
  }

  async checkInboundAllowed(
    runtime: ChannelRuntime<EmailChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<ChannelInboundDecision> {
    const binding = await this.resolveBindingForEvent(runtime, event)
    return checkAccountInboundPolicy(binding, event)
  }

  async pollOnce(runtime: EmailRuntime): Promise<void> {
    if (runtime.stopped || runtime.polling) {
      return
    }
    runtime.polling = true
    let client: ImapClientLike | undefined
    try {
      const config = runtime.config ?? parseEmailChannelConfig(runtime.accountBinding?.config ?? {}, runtime.accountId)
      const password = config.credentialRef
        ? await this.secretsStore.getSecret(runtime.commanderId ?? '', config.credentialRef)
        : null
      if (!password) {
        throw new Error('Email channel credential is missing from the encrypted vault')
      }

      client = new ImapFlow({
        host: config.imapHost,
        port: config.imapPort,
        secure: config.imapSecure,
        auth: {
          user: config.username,
          pass: password,
        },
      }) as unknown as ImapClientLike
      runtime.imapClient = client
      await client.connect()
      const lock = await client.getMailboxLock(config.imapMailbox)
      const acceptedUids: Array<number | string> = []
      try {
        const uids = await client.search({ seen: false })
        for await (const message of client.fetch(uids, { uid: true, source: true, envelope: true })) {
          if (!message.source) {
            continue
          }
          const accepted = await this.ingestParsedMessage(runtime, config, message)
          if (accepted && message.uid !== undefined) {
            acceptedUids.push(message.uid)
          }
        }
      } finally {
        lock.release()
      }
      for (const uid of acceptedUids) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
      }
    } finally {
      if (client) {
        await client.logout().catch(() => undefined)
      }
      if (runtime.imapClient === client) {
        runtime.imapClient = undefined
      }
      runtime.polling = false
    }
  }

  private async ingestParsedMessage(
    runtime: EmailRuntime,
    config: EmailChannelConfig,
    message: ImapFetchMessageLike,
  ): Promise<boolean> {
    const parsed = (await simpleParser(message.source ?? '')) as ParsedMailLike
    const sender = firstAddress(parsed.from)
    if (!sender) {
      return true
    }
    const recipients = [...addressList(parsed.to), ...addressList(parsed.cc)]
    const autoSubmitted = headerValue(parsed.headers, 'auto-submitted')
    const filtered = checkEmailInboundFilter({
      from: sender,
      selfAddresses: [config.fromAddress, config.replyFromAddress ?? '', config.username],
      autoSubmitted,
    })
    if (!filtered.allowed) {
      return true
    }

    const messageId = normalizeMessageId(parsed.messageId ?? message.envelope?.messageId)
      ?? `<herd-${randomUUID()}@local>`
    const references = normalizeReferences(parsed.references)
    const inReplyTo = normalizeMessageId(parsed.inReplyTo)
    const threadId = references[0] ?? inReplyTo ?? messageId

    const routing = await this.resolveRouting(runtime, recipients)
    if (!routing) {
      this.logger.warn(`[channels/email] No commander route for message from ${sender} to ${recipients.join(', ')}`)
      return false
    }
    const policy = await checkAccountInboundPolicy(routing.binding, {
      provider: 'email',
      accountId: runtime.accountId,
      chatType: 'direct',
      peerId: sender,
      threadId,
      text: textFromParsedMail(parsed),
      rawTimestamp: parsed.date?.toISOString() ?? new Date().toISOString(),
      rawSourceId: messageId,
    })
    if (!policy.allowed) {
      this.logger.warn(`[channels/email] Inbound email from ${sender} rejected by policy: ${policy.reason ?? 'denied'}`)
      return true
    }

    const attachments = await this.cacheAttachments(runtime.accountId, messageId, parsed.attachments ?? [])
    const body = this.formatInboundBody(parsed, attachments)

    const payload: EmailChannelMessagePayload = {
      provider: 'email',
      accountId: runtime.accountId,
      chatType: 'direct',
      peerId: sender,
      displayName: sender,
      message: body,
      mode: 'followup',
      commanderId: routing.commanderId,
      subject: normalizeSubject(parsed.subject),
      threadId,
      rawTimestamp: parsed.date?.toISOString() ?? new Date().toISOString(),
      rawSourceId: messageId,
    }

    const response = await this.fetchImpl(`${this.apiBaseUrl}/api/commanders/channel-message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-herd-internal-token': this.internalToken,
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      this.logger.warn(`[channels/email] Failed to ingest email message ${messageId}: ${response.status} ${text}`)
      return false
    }
    return true
  }

  private async resolveBindingForRuntime(
    runtime: ChannelRuntime<EmailChannelConfig>,
    conversation: Conversation,
  ): Promise<CommanderChannelBinding> {
    const bindings = await this.bindingStore.listByCommander(conversation.commanderId)
    const binding = bindings.find((candidate) => (
      candidate.provider === 'email'
      && candidate.accountId === runtime.accountId
      && candidate.enabled
    ))
    if (!binding) {
      throw new Error(`No email channel binding for commander "${conversation.commanderId}" and account "${runtime.accountId}"`)
    }
    return binding
  }

  private async resolveBindingForEvent(
    runtime: ChannelRuntime<EmailChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<CommanderChannelBinding> {
    const commanderId = runtime.commanderId
    if (!commanderId) {
      throw new Error('Email runtime has no commander id for inbound policy check')
    }
    const bindings = await this.bindingStore.listByCommander(commanderId)
    const binding = bindings.find((candidate) => (
      candidate.provider === 'email'
      && candidate.accountId === event.accountId
      && candidate.enabled
    ))
    if (!binding) {
      throw new Error(`No email channel binding for commander "${commanderId}" and account "${event.accountId}"`)
    }
    return binding
  }

  private async resolveRouting(
    runtime: EmailRuntime,
    recipients: readonly string[],
  ): Promise<{ commanderId: string; binding: CommanderChannelBinding } | null> {
    const alias = parsePlusAliasFromRecipients(recipients)
    const bindings = (await this.bindingStore.list())
      .filter((binding) => (
        binding.enabled
        && binding.provider === 'email'
        && binding.accountId === runtime.accountId
      ))
    if (alias) {
      const matched = bindings.find((binding) => (
        normalizeEmailAlias(parseEmailChannelConfig(binding.config, binding.accountId).emailAlias) === alias
      ))
      if (matched) {
        return { commanderId: matched.commanderId, binding: matched }
      }
    }

    const envDefault = this.env.COMMANDER_EMAIL_DEFAULT_COMMANDER?.trim()
    const preferredCommanderId = envDefault || runtime.commanderId
    const binding = bindings.find((candidate) => candidate.commanderId === preferredCommanderId)
      ?? bindings.find((candidate) => candidate.commanderId === runtime.commanderId)
      ?? bindings[0]
    return binding
      ? { commanderId: effectiveBindingCommanderId(binding, preferredCommanderId), binding }
      : null
  }

  private async cacheAttachments(
    accountId: string,
    messageId: string,
    attachments: readonly ParsedAttachmentLike[],
  ): Promise<Array<{ filename: string; path: string; contentType?: string }>> {
    const cached: Array<{ filename: string; path: string; contentType?: string }> = []
    if (attachments.length === 0) {
      return cached
    }
    const root = path.join(
      this.dataDir,
      'channels',
      'email',
      hashPathToken(accountId),
      'attachments',
      hashPathToken(messageId),
    )
    await mkdir(root, { recursive: true, mode: 0o700 })
    let index = 0
    for (const attachment of attachments) {
      if (!attachment.content) {
        continue
      }
      index += 1
      const filename = safeFileName(attachment.filename, `attachment-${index}`)
      const filePath = path.join(root, filename)
      await writeFile(filePath, attachment.content, { mode: 0o600 })
      cached.push({
        filename,
        path: filePath,
        ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
      })
    }
    return cached
  }

  private formatInboundBody(
    parsed: ParsedMailLike,
    attachments: Array<{ filename: string; path: string; contentType?: string }>,
  ): string {
    const body = textFromParsedMail(parsed)
    if (attachments.length === 0) {
      return body
    }
    const attachmentLines = attachments.map((attachment) => (
      `- [${attachment.filename}](${attachment.path})`
    ))
    return `${body}\n\nAttachments:\n${attachmentLines.join('\n')}`.trim()
  }
}
