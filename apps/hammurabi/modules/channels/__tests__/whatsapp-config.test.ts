import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommanderSecretsStore } from '../../commanders/secrets-store'
import {
  parseWhatsAppChannelConfig,
  prepareWhatsAppChannelConfigForStorage,
  whatsappAccessTokenRef,
} from '../whatsapp/config'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-whatsapp-config-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('WhatsApp channel config', () => {
  it('normalizes Baileys defaults into the commander data directory', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig({}, 'Personal WhatsApp', dataDir)

    expect(config).toMatchObject({
      provider: 'whatsapp',
      transport: 'baileys',
      dmPolicy: 'allowlist',
      groupPolicy: 'disabled',
      requireMention: false,
      baileys: {
        browserName: 'Hervald',
        connectTimeoutMs: 30_000,
        printQrInTerminal: true,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        reconnect: true,
        sendTextWithVoiceNote: false,
      },
      stt: { enabled: true },
      tts: { enabled: false, voice: 'alloy' },
    })
    expect(config.baileys.authStateDir).toContain('/channels/whatsapp/')
    expect(config.baileys.authStateDir).not.toContain('Personal WhatsApp')
    expect(config.baileys.authStateDir?.endsWith(`${sep}auth`)).toBe(true)
  })

  it('rejects Baileys auth state paths outside the account data root', async () => {
    const dataDir = await createTempDir()

    expect(() => parseWhatsAppChannelConfig({
      baileys: {
        authStateDir: '../stolen-auth',
      },
    }, 'pm-ai', dataDir)).toThrow(/authStateDir must stay within/)

    const config = parseWhatsAppChannelConfig({
      baileys: {
        authStateDir: 'auth',
      },
    }, '../../pm-ai', dataDir)
    expect(relative(dataDir, config.baileys.authStateDir ?? '')).not.toMatch(/^\.\.(?:\/|$)/u)
    expect(config.baileys.authStateDir?.endsWith(`${sep}auth`)).toBe(true)
  })

  it('stores Cloud access tokens as commander secrets and strips raw credentials', async () => {
    const dataDir = await createTempDir()
    const secretsStore = new CommanderSecretsStore({
      dataDir,
      keyFilePath: join(dataDir, 'master.key'),
    })

    const prepared = await prepareWhatsAppChannelConfigForStorage({
      commanderId: COMMANDER_ID,
      accountId: 'pm-ai',
      incomingConfig: {
        provider: 'whatsapp',
        transport: 'cloud',
        cloud: {
          phoneNumberId: '12345',
          verifyToken: 'verify-me',
          accessToken: 'secret-token',
        },
      },
      secretsStore,
      dataDir,
    })

    expect(prepared.credentialUpdated).toBe(true)
    expect(prepared.config).toMatchObject({
      provider: 'whatsapp',
      transport: 'cloud',
      cloud: {
        phoneNumberId: '12345',
        verifyToken: 'verify-me',
        accessTokenConfigured: true,
        accessTokenRef: whatsappAccessTokenRef('pm-ai'),
      },
    })
    expect(prepared.config).not.toHaveProperty('accessToken')
    expect(prepared.config.cloud).not.toHaveProperty('accessToken')
    await expect(
      secretsStore.getSecret(COMMANDER_ID, whatsappAccessTokenRef('pm-ai')),
    ).resolves.toBe('secret-token')
  })
})
