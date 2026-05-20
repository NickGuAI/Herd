import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../commanders/conversation-store'
import { CommanderSecretsStore } from '../../commanders/secrets-store'
import { CommanderChannelBindingStore } from '../store'
import { EmailChannelAdapter } from '../email/adapter'
import { emailCredentialRef, parseEmailChannelConfig } from '../email/config'

const nodemailerMock = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({ messageId: 'smtp-message-id' }))
  const close = vi.fn()
  const createTransport = vi.fn(() => ({ sendMail, close }))
  return { sendMail, close, createTransport }
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: nodemailerMock.createTransport,
  },
}))

const imapMock = vi.hoisted(() => {
  const connect = vi.fn(async () => undefined)
  const release = vi.fn()
  const logout = vi.fn(async () => undefined)
  const search = vi.fn(async () => [1])
  const messageFlagsAdd = vi.fn(async () => undefined)
  const messages: Array<{ uid?: number; source?: Buffer; envelope?: { messageId?: string } }> = []

  class MockImapFlow {
    connect = connect
    logout = logout
    search = search
    messageFlagsAdd = messageFlagsAdd

    async getMailboxLock() {
      return { release }
    }

    async *fetch() {
      for (const message of messages) {
        yield message
      }
    }
  }

  return {
    connect,
    release,
    logout,
    search,
    messageFlagsAdd,
    messages,
    ImapFlow: MockImapFlow,
  }
})

const mailparserMock = vi.hoisted(() => ({
  simpleParser: vi.fn(),
}))

vi.mock('imapflow', () => ({
  ImapFlow: imapMock.ImapFlow,
}))

vi.mock('mailparser', () => ({
  simpleParser: mailparserMock.simpleParser,
}))

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const OTHER_COMMANDER_ID = '33333333-3333-4333-8333-333333333333'
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-email-adapter-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  nodemailerMock.sendMail.mockClear()
  nodemailerMock.close.mockClear()
  nodemailerMock.createTransport.mockClear()
  imapMock.connect.mockClear()
  imapMock.release.mockClear()
  imapMock.logout.mockClear()
  imapMock.search.mockClear()
  imapMock.messageFlagsAdd.mockClear()
  imapMock.messages.splice(0)
  mailparserMock.simpleParser.mockReset()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('EmailChannelAdapter', () => {
  it('sends commander replies through SMTP using conversation route metadata', async () => {
    const dir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const credentialRef = emailCredentialRef('assistant@example.com')
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, 'smtp-password')
    await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      config: {
        provider: 'email',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        replyFromAddress: 'reply@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpSecure: true,
        allowlist: ['nick@example.com'],
        credentialRef,
        credentialConfigured: true,
      },
    })
    const adapter = new EmailChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir: dir,
    })

    const conversation = {
      id: 'conversation-1',
      commanderId: COMMANDER_ID,
      channelMeta: {
        provider: 'email',
        chatType: 'direct',
        accountId: 'assistant@example.com',
        peerId: 'nick@example.com',
        sessionKey: 'email:assistant@example.com:nick@example.com',
        displayName: 'Nick',
        subject: 'Need help',
        threadId: '<thread-1@example.com>',
        references: ['<root@example.com>'],
      },
      lastRoute: {
        channel: 'email',
        to: '"Nick" <nick@example.com>',
        accountId: 'assistant@example.com',
        threadId: '<thread-1@example.com>',
      },
    } as Conversation

    const result = await adapter.send(
      { provider: 'email', accountId: 'assistant@example.com', commanderId: COMMANDER_ID },
      conversation,
      { text: 'Commander reply\nMEDIA:/tmp/report.pdf' },
    )

    expect(result.success).toBe(true)
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: {
        user: 'assistant@example.com',
        pass: 'smtp-password',
      },
    })
    expect(nodemailerMock.sendMail).toHaveBeenCalledWith({
      from: 'reply@example.com',
      to: 'nick@example.com',
      subject: 'Re: Need help',
      text: 'Commander reply',
      inReplyTo: '<thread-1@example.com>',
      references: ['<root@example.com>', '<thread-1@example.com>'],
      attachments: [{ path: '/tmp/report.pdf' }],
    })
    expect(nodemailerMock.close).toHaveBeenCalledTimes(1)
  })

  it('applies the email allowlist before ingesting IMAP messages', async () => {
    const dir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const credentialRef = emailCredentialRef('assistant@example.com')
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, 'imap-password')
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      config: {
        provider: 'email',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        emailAlias: 'atlas',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapSecure: true,
        imapMailbox: 'INBOX',
        allowlist: ['nick@example.com'],
        dmPolicy: 'allowlist',
        credentialRef,
        credentialConfigured: true,
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    const adapter = new EmailChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir: dir,
      fetchImpl,
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        log: vi.fn(),
      },
    })

    imapMock.messages.push({
      uid: 7,
      source: Buffer.from('raw message'),
      envelope: { messageId: '<message-1@example.com>' },
    })
    mailparserMock.simpleParser.mockResolvedValueOnce({
      from: { value: [{ address: 'intruder@example.com' }] },
      to: { value: [{ address: 'assistant+atlas@example.com' }] },
      subject: 'Blocked message',
      messageId: '<message-1@example.com>',
      text: 'hello',
      date: new Date('2026-05-17T00:00:00.000Z'),
      headers: new Map(),
      attachments: [],
    })

    await adapter.pollOnce({
      provider: 'email',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config: parseEmailChannelConfig(binding.config, binding.accountId),
      accountBinding: binding,
      stopped: false,
      polling: false,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(imapMock.messageFlagsAdd).toHaveBeenCalledWith(7, ['\\Seen'], { uid: true })
  })

  it('ingests allowed IMAP messages into the canonical channel-message API', async () => {
    const dir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const credentialRef = emailCredentialRef('assistant@example.com')
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, 'imap-password')
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      config: {
        provider: 'email',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        emailAlias: 'atlas',
        allowlist: ['nick@example.com'],
        dmPolicy: 'allowlist',
        credentialRef,
        credentialConfigured: true,
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    const adapter = new EmailChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir: dir,
      apiBaseUrl: 'http://127.0.0.1:20001',
      fetchImpl,
    })

    imapMock.messages.push({
      uid: 9,
      source: Buffer.from('raw message'),
      envelope: { messageId: '<message-2@example.com>' },
    })
    mailparserMock.simpleParser.mockResolvedValueOnce({
      from: { value: [{ address: 'nick@example.com' }] },
      to: { value: [{ address: 'assistant+atlas@example.com' }] },
      subject: 'Allowed message',
      messageId: '<message-2@example.com>',
      references: ['<root@example.com>'],
      text: 'hello from email',
      date: new Date('2026-05-17T00:00:00.000Z'),
      headers: new Map(),
      attachments: [],
    })

    await adapter.pollOnce({
      provider: 'email',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config: parseEmailChannelConfig(binding.config, binding.accountId),
      accountBinding: binding,
      stopped: false,
      polling: false,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:20001/api/commanders/channel-message')
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hammurabi-internal-token': 'internal-token',
      },
    })
    expect(JSON.parse(String(request?.body))).toMatchObject({
      provider: 'email',
      accountId: 'assistant@example.com',
      peerId: 'nick@example.com',
      commanderId: COMMANDER_ID,
      subject: 'Allowed message',
      threadId: '<root@example.com>',
      message: 'hello from email',
    })
    expect(imapMock.messageFlagsAdd).toHaveBeenCalledWith(9, ['\\Seen'], { uid: true })
  })

  it('marks accepted IMAP messages as seen only after the fetch stream is drained', async () => {
    const dir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const credentialRef = emailCredentialRef('assistant@example.com')
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, 'imap-password')
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      config: {
        provider: 'email',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        emailAlias: 'atlas',
        allowlist: ['nick@example.com'],
        dmPolicy: 'allowlist',
        credentialRef,
        credentialConfigured: true,
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    const adapter = new EmailChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir: dir,
      fetchImpl,
    })

    imapMock.messages.push(
      { uid: 21, source: Buffer.from('raw message 1'), envelope: { messageId: '<message-21@example.com>' } },
      { uid: 22, source: Buffer.from('raw message 2'), envelope: { messageId: '<message-22@example.com>' } },
    )
    let parseCount = 0
    mailparserMock.simpleParser.mockImplementation(async () => {
      parseCount += 1
      if (parseCount === 2) {
        expect(imapMock.messageFlagsAdd).not.toHaveBeenCalled()
      }
      return {
        from: { value: [{ address: 'nick@example.com' }] },
        to: { value: [{ address: 'assistant+atlas@example.com' }] },
        subject: `Allowed message ${parseCount}`,
        messageId: `<message-${parseCount}@example.com>`,
        text: `hello ${parseCount}`,
        date: new Date('2026-05-17T00:00:00.000Z'),
        headers: new Map(),
        attachments: [],
      }
    })

    await adapter.pollOnce({
      provider: 'email',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config: parseEmailChannelConfig(binding.config, binding.accountId),
      accountBinding: binding,
      stopped: false,
      polling: false,
    })

    expect(imapMock.messageFlagsAdd).toHaveBeenNthCalledWith(1, 21, ['\\Seen'], { uid: true })
    expect(imapMock.messageFlagsAdd).toHaveBeenNthCalledWith(2, 22, ['\\Seen'], { uid: true })
  })

  it('logs out of IMAP when a poll cycle throws before completion', async () => {
    const dir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const credentialRef = emailCredentialRef('assistant@example.com')
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, 'imap-password')
    const binding = await bindingStore.create({
      commanderId: COMMANDER_ID,
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      config: {
        provider: 'email',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        allowlist: ['nick@example.com'],
        dmPolicy: 'allowlist',
        credentialRef,
        credentialConfigured: true,
      },
    })
    const adapter = new EmailChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir: dir,
    })

    imapMock.messages.push({
      uid: 31,
      source: Buffer.from('raw message'),
      envelope: { messageId: '<message-31@example.com>' },
    })
    mailparserMock.simpleParser.mockRejectedValueOnce(new Error('parser failed'))

    await expect(adapter.pollOnce({
      provider: 'email',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config: parseEmailChannelConfig(binding.config, binding.accountId),
      accountBinding: binding,
      stopped: false,
      polling: false,
    })).rejects.toThrow('parser failed')

    expect(imapMock.release).toHaveBeenCalledTimes(1)
    expect(imapMock.logout).toHaveBeenCalledTimes(1)
  })

  it('uses the selected fallback binding commander instead of a stale runtime or env default', async () => {
    const dir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const credentialRef = emailCredentialRef('assistant@example.com')
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, 'imap-password')
    const binding = await bindingStore.create({
      commanderId: OTHER_COMMANDER_ID,
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      config: {
        provider: 'email',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        allowlist: ['nick@example.com'],
        dmPolicy: 'allowlist',
        credentialRef,
        credentialConfigured: true,
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    const adapter = new EmailChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir: dir,
      fetchImpl,
      env: {
        COMMANDER_EMAIL_DEFAULT_COMMANDER: COMMANDER_ID,
      },
    })

    imapMock.messages.push({
      uid: 11,
      source: Buffer.from('raw message'),
      envelope: { messageId: '<message-3@example.com>' },
    })
    mailparserMock.simpleParser.mockResolvedValueOnce({
      from: { value: [{ address: 'nick@example.com' }] },
      to: { value: [{ address: 'assistant@example.com' }] },
      subject: 'Fallback message',
      messageId: '<message-3@example.com>',
      text: 'hello fallback',
      date: new Date('2026-05-17T00:00:00.000Z'),
      headers: new Map(),
      attachments: [],
    })

    await adapter.pollOnce({
      provider: 'email',
      accountId: binding.accountId,
      commanderId: COMMANDER_ID,
      config: parseEmailChannelConfig(binding.config, binding.accountId),
      accountBinding: {
        ...binding,
        commanderId: COMMANDER_ID,
      },
      stopped: false,
      polling: false,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, request] = fetchImpl.mock.calls[0] ?? []
    expect(JSON.parse(String(request?.body))).toMatchObject({
      provider: 'email',
      accountId: 'assistant@example.com',
      peerId: 'nick@example.com',
      commanderId: OTHER_COMMANDER_ID,
      message: 'hello fallback',
    })
  })
})
