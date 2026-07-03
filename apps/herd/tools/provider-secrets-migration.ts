import { access, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { resolveModuleDataDir } from '../modules/data-dir.js'
import {
  defaultProviderSecretKeyPath,
  defaultProviderSecretStorePath,
} from '../server/api-keys/provider-secrets-store.js'

export type ProviderSecretsMigrationSkippedReason =
  | 'legacy_absent'
  | 'target_exists'
  | 'same_path'

export type ProviderSecretsMigrationErrorReason =
  | 'partial_legacy_pair'
  | 'partial_target_pair'

export interface ProviderSecretsMigrationPathResult {
  label: 'secrets' | 'encryption-key'
  legacyPath: string
  providerPath: string
  action: 'migrated' | 'skipped'
  reason?: ProviderSecretsMigrationSkippedReason
}

export interface ProviderSecretsMigrationOptions {
  legacyFilePath?: string
  legacyKeyFilePath?: string
  providerFilePath?: string
  providerKeyFilePath?: string
}

export interface ProviderSecretsMigrationResult {
  results: ProviderSecretsMigrationPathResult[]
}

export class ProviderSecretsMigrationError extends Error {
  constructor(
    message: string,
    readonly reason: ProviderSecretsMigrationErrorReason,
  ) {
    super(message)
    this.name = 'ProviderSecretsMigrationError'
  }
}

function defaultLegacyProviderSecretStorePath(): string {
  return path.join(resolveModuleDataDir('api-keys'), 'transcription-secrets.json')
}

function defaultLegacyProviderSecretKeyPath(): string {
  return path.join(resolveModuleDataDir('api-keys'), 'transcription-secrets.key')
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function runProviderSecretsMigration(
  options: ProviderSecretsMigrationOptions = {},
): Promise<ProviderSecretsMigrationResult> {
  const legacyFilePath = options.legacyFilePath ?? defaultLegacyProviderSecretStorePath()
  const legacyKeyFilePath = options.legacyKeyFilePath ?? defaultLegacyProviderSecretKeyPath()
  const providerFilePath = options.providerFilePath ?? defaultProviderSecretStorePath()
  const providerKeyFilePath = options.providerKeyFilePath ?? defaultProviderSecretKeyPath()
  const baseResults = [
    {
      label: 'secrets' as const,
      legacyPath: legacyFilePath,
      providerPath: providerFilePath,
    },
    {
      label: 'encryption-key' as const,
      legacyPath: legacyKeyFilePath,
      providerPath: providerKeyFilePath,
    },
  ]

  if (legacyFilePath === providerFilePath && legacyKeyFilePath === providerKeyFilePath) {
    return {
      results: baseResults.map((entry) => ({
        ...entry,
        action: 'skipped',
        reason: 'same_path',
      })),
    }
  }

  const [
    legacyFileExists,
    legacyKeyExists,
    providerFileExists,
    providerKeyExists,
  ] = await Promise.all([
    pathExists(legacyFilePath),
    pathExists(legacyKeyFilePath),
    pathExists(providerFilePath),
    pathExists(providerKeyFilePath),
  ])

  if (providerFileExists || providerKeyExists) {
    if (providerFileExists !== providerKeyExists) {
      throw new ProviderSecretsMigrationError(
        'Refusing provider secret migration because only one canonical provider secret target exists. Move or remove the mixed target files before migrating.',
        'partial_target_pair',
      )
    }
    return {
      results: baseResults.map((entry) => ({
        ...entry,
        action: 'skipped',
        reason: 'target_exists',
      })),
    }
  }

  if (!legacyFileExists && !legacyKeyExists) {
    return {
      results: baseResults.map((entry) => ({
        ...entry,
        action: 'skipped',
        reason: 'legacy_absent',
      })),
    }
  }

  if (legacyFileExists !== legacyKeyExists) {
    throw new ProviderSecretsMigrationError(
      'Refusing provider secret migration because only one legacy transcription secret file exists. The encrypted secrets file and encryption key must migrate as a pair.',
      'partial_legacy_pair',
    )
  }

  await mkdir(path.dirname(providerFilePath), { recursive: true })
  await mkdir(path.dirname(providerKeyFilePath), { recursive: true })
  await rename(legacyFilePath, providerFilePath)

  try {
    await rename(legacyKeyFilePath, providerKeyFilePath)
  } catch (error) {
    await rename(providerFilePath, legacyFilePath).catch(() => undefined)
    throw error
  }

  return {
    results: baseResults.map((entry) => ({
      ...entry,
      action: 'migrated',
    })),
  }
}
