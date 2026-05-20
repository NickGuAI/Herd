import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { CommanderSecretsStore } from '../../commanders/secrets-store'
import {
  emailCredentialRef,
  prepareEmailChannelConfigForStorage,
} from '../email/config'
import { checkEmailInboundFilter } from '../email/filters'
import { parsePlusAliasFromRecipients } from '../email/plus-address'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-email-channel-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('email channel config', () => {
  it('stores app passwords in the encrypted commander vault and strips credential input', async () => {
    const dir = await createTempDir()
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })

    const prepared = await prepareEmailChannelConfigForStorage({
      commanderId: COMMANDER_ID,
      accountId: 'Assistant@Example.com',
      incomingConfig: {
        appPassword: 'super-secret-app-password',
        username: 'assistant@example.com',
        fromAddress: 'assistant@example.com',
        allowlist: ['nick@example.com'],
      },
      secretsStore,
    })

    expect(prepared.credentialUpdated).toBe(true)
    expect(prepared.config).toMatchObject({
      provider: 'email',
      username: 'assistant@example.com',
      fromAddress: 'assistant@example.com',
      credentialConfigured: true,
      allowlist: ['nick@example.com'],
      dmPolicy: 'allowlist',
      groupPolicy: 'disabled',
    })
    expect(prepared.config).not.toHaveProperty('appPassword')
    expect(prepared.config).not.toHaveProperty('password')
    expect(prepared.config).not.toHaveProperty('credential')

    const credentialRef = emailCredentialRef('Assistant@Example.com')
    await expect(secretsStore.getSecret(COMMANDER_ID, credentialRef)).resolves.toBe('super-secret-app-password')
    const encryptedFile = await readFile(join(dir, COMMANDER_ID, 'secrets.enc'), 'utf8')
    expect(encryptedFile).not.toContain('super-secret-app-password')
  })

  it('retains the existing credential when configuration is updated without a new password', async () => {
    const dir = await createTempDir()
    const secretsStore = new CommanderSecretsStore({
      dataDir: dir,
      keyFilePath: join(dir, 'master.key'),
    })
    const first = await prepareEmailChannelConfigForStorage({
      commanderId: COMMANDER_ID,
      accountId: 'assistant@example.com',
      incomingConfig: {
        appPassword: 'initial-secret',
        imapHost: 'imap.example.com',
        allowlist: ['nick@example.com'],
      },
      secretsStore,
    })

    const next = await prepareEmailChannelConfigForStorage({
      commanderId: COMMANDER_ID,
      accountId: 'assistant@example.com',
      existingConfig: first.config,
      incomingConfig: {
        allowlist: ['team@example.com'],
      },
      secretsStore,
    })

    const credentialRef = emailCredentialRef('assistant@example.com')
    expect(next.credentialUpdated).toBe(false)
    expect(next.config).toMatchObject({
      credentialRef,
      credentialConfigured: true,
      imapHost: 'imap.example.com',
      allowlist: ['team@example.com'],
    })
    await expect(secretsStore.getSecret(COMMANDER_ID, credentialRef)).resolves.toBe('initial-secret')
  })

  it('routes plus-address aliases and filters obvious non-human inbound mail', () => {
    expect(parsePlusAliasFromRecipients([
      'Hervald <assistant+atlas@example.com>',
      'assistant@example.com',
    ])).toBe('atlas')

    expect(checkEmailInboundFilter({
      from: 'postmaster@example.com',
      selfAddresses: ['assistant@example.com'],
    })).toEqual({ allowed: false, reason: 'noreply-sender' })
    expect(checkEmailInboundFilter({
      from: 'nick@example.com',
      selfAddresses: ['assistant@example.com'],
      autoSubmitted: 'auto-generated',
    })).toEqual({ allowed: false, reason: 'auto-submitted' })
  })

  it('does not leave the legacy commander email rail in source', () => {
    const currentFile = fileURLToPath(import.meta.url)
    const modulesRoot = dirname(dirname(dirname(currentFile)))
    expect(existsSync(join(modulesRoot, 'commanders', 'email-poller.ts'))).toBe(false)
    expect(existsSync(join(modulesRoot, 'commanders', 'email-config.ts'))).toBe(false)
    expect(existsSync(join(modulesRoot, 'commanders', 'routes', 'register-email.ts'))).toBe(false)
  })
})
