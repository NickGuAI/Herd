import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveHerdDataDir, resolveModuleDataDir } from '../modules/data-dir.js'
import {
  resolveCommanderDataDir,
  resolveCommanderSessionStorePath,
} from '../modules/commanders/paths.js'
import { JSON_STORE_SCHEMA_VERSION, withJsonStoreSchema } from '../modules/json-store-schema.js'
import { quarantineJsonFile, writeJsonFileAtomically } from '../modules/json-file.js'

export type HerdJsonStoreMigrationStatus =
  | 'ready'
  | 'migrated'
  | 'quarantined'
  | 'stale'
  | 'corrupt'
  | 'unwritable'

export interface HerdJsonStoreReadinessEntry {
  id: string
  path: string
  ready: boolean
  schemaVersion: number | null
  requiredSchemaVersion: number
  migrationStatus: HerdJsonStoreMigrationStatus
  error: string | null
  quarantinePath?: string | null
}

export interface HerdJsonStoreReadiness {
  ready: boolean
  sourceRoot: string
  requiredSchemaVersion: number
  migrationStatus: HerdJsonStoreMigrationStatus
  stores: HerdJsonStoreReadinessEntry[]
  error: string | null
}

interface JsonStoreContract {
  id: string
  filePath: string
  acceptsLegacyPayload: (payload: Record<string, unknown>) => boolean
  corruptPolicy?: 'fail' | 'quarantine'
}

export class HerdJsonStoresNotReadyError extends Error {
  constructor(readonly readiness: HerdJsonStoreReadiness) {
    super(formatJsonStoresNotReadyMessage(readiness))
    this.name = 'HerdJsonStoresNotReadyError'
  }
}

function formatJsonStoresNotReadyMessage(readiness: HerdJsonStoreReadiness): string {
  const failedStores = readiness.stores
    .filter((store) => !store.ready)
    .map((store) => {
      const detail = store.error ? `\n  ${store.error}` : ''
      return `- ${store.id}: ${store.migrationStatus} at ${store.path}${detail}`
    })

  return [
    '[json-stores] Herd JSON data stores are not ready.',
    `status: ${readiness.migrationStatus}`,
    `data dir: ${readiness.sourceRoot}`,
    `required schema: ${readiness.requiredSchemaVersion}`,
    ...failedStores,
  ].join('\n')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasArrayField(field: string): (payload: Record<string, unknown>) => boolean {
  return (payload) => Array.isArray(payload[field])
}

function hasObjectField(field: string): (payload: Record<string, unknown>) => boolean {
  return (payload) => isObject(payload[field])
}

function hasStringField(payload: Record<string, unknown>, field: string): boolean {
  return typeof payload[field] === 'string' && payload[field].trim().length > 0
}

function acceptsOperatorPayload(payload: Record<string, unknown>): boolean {
  return (
    hasStringField(payload, 'id') &&
    hasStringField(payload, 'kind') &&
    hasStringField(payload, 'displayName') &&
    hasStringField(payload, 'createdAt')
  )
}

function acceptsSettingsPayload(payload: Record<string, unknown>): boolean {
  return (
    payload.theme !== undefined ||
    payload.fontScale !== undefined ||
    payload.composerAbilities !== undefined ||
    payload.composerSkillSlots !== undefined ||
    payload.updatedAt !== undefined
  )
}

function acceptsPolicyPayload(payload: Record<string, unknown>): boolean {
  return (
    payload.version === 1 ||
    isObject(payload.global) ||
    isObject(payload.commanders) ||
    isObject(payload.settings)
  )
}

function acceptsPendingPolicyPayload(payload: Record<string, unknown>): boolean {
  return payload.version === 1 || Array.isArray(payload.approvals) || Array.isArray(payload.pending)
}

function acceptsConversationPayload(payload: Record<string, unknown>): boolean {
  return (
    hasStringField(payload, 'id') &&
    hasStringField(payload, 'commanderId') &&
    hasStringField(payload, 'surface') &&
    hasStringField(payload, 'status')
  )
}

function acceptsAutomationPayload(payload: Record<string, unknown>): boolean {
  return (
    hasStringField(payload, 'id') &&
    hasStringField(payload, 'name') &&
    hasStringField(payload, 'trigger') &&
    hasStringField(payload, 'instruction') &&
    hasStringField(payload, 'status')
  )
}

function toReadinessEnv(
  sourceRoot: string | undefined,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!sourceRoot) {
    return env
  }
  return {
    ...env,
    HERD_DATA_DIR: sourceRoot,
  }
}

function resolveSourceRoot(options: {
  sourceRoot?: string
  env: NodeJS.ProcessEnv
}): string {
  return path.resolve(options.sourceRoot ?? resolveHerdDataDir(options.env))
}

async function pathIsFile(filePath: string): Promise<boolean | 'missing'> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing'
    }
    throw error
  }
}

async function addOptionalFile(
  stores: JsonStoreContract[],
  contract: JsonStoreContract,
): Promise<void> {
  const status = await pathIsFile(contract.filePath)
  if (status === 'missing') {
    return
  }
  stores.push(contract)
}

async function addCommanderScopedStores(
  stores: JsonStoreContract[],
  commanderDataDir: string,
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(commanderDataDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const commanderRoot = path.join(commanderDataDir, entry.name)
    await addOptionalFile(stores, {
      id: `commanders.${entry.name}.quests`,
      filePath: path.join(commanderRoot, 'quests.json'),
      acceptsLegacyPayload: hasArrayField('quests'),
    })

    const conversationsDir = path.join(commanderRoot, 'conversations')
    let conversationFiles: import('node:fs').Dirent[]
    try {
      conversationFiles = await readdir(conversationsDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }

    for (const conversationFile of conversationFiles) {
      if (!conversationFile.isFile() || !conversationFile.name.endsWith('.json')) {
        continue
      }
      stores.push({
        id: `commanders.${entry.name}.conversation.${path.basename(conversationFile.name, '.json')}`,
        filePath: path.join(conversationsDir, conversationFile.name),
        acceptsLegacyPayload: acceptsConversationPayload,
        corruptPolicy: 'quarantine',
      })
    }
  }
}

async function addAutomationStores(
  stores: JsonStoreContract[],
  automationDataDir: string,
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(automationDataDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'manifest.json') {
      continue
    }
    stores.push({
      id: `automations.${path.basename(entry.name, '.json')}`,
      filePath: path.join(automationDataDir, entry.name),
      acceptsLegacyPayload: acceptsAutomationPayload,
      corruptPolicy: 'quarantine',
    })
  }
}

async function collectJsonStoreContracts(options: {
  sourceRoot?: string
  env: NodeJS.ProcessEnv
}): Promise<JsonStoreContract[]> {
  const sourceRoot = resolveSourceRoot(options)
  const env = toReadinessEnv(sourceRoot, options.env)
  const commanderDataDir = path.resolve(
    options.sourceRoot ? path.join(sourceRoot, 'commander') : resolveCommanderDataDir(env),
  )
  const automationDataDir = path.resolve(
    options.sourceRoot ? path.join(sourceRoot, 'automations') : resolveModuleDataDir('automations', env),
  )
  const stores: JsonStoreContract[] = []

  await addOptionalFile(stores, {
    id: 'commanders.sessions',
    filePath: resolveCommanderSessionStorePath(commanderDataDir),
    acceptsLegacyPayload: hasArrayField('sessions'),
  })
  await addCommanderScopedStores(stores, commanderDataDir)
  await addAutomationStores(stores, automationDataDir)

  await Promise.all([
    addOptionalFile(stores, {
      id: 'api-keys.keys',
      filePath: path.join(sourceRoot, 'api-keys', 'keys.json'),
      acceptsLegacyPayload: hasArrayField('keys'),
    }),
    addOptionalFile(stores, {
      id: 'api-keys.provider-secrets',
      filePath: path.join(sourceRoot, 'api-keys', 'provider-secrets.json'),
      acceptsLegacyPayload: hasObjectField('secrets'),
    }),
    addOptionalFile(stores, {
      id: 'policies.policies',
      filePath: path.join(sourceRoot, 'policies', 'policies.json'),
      acceptsLegacyPayload: acceptsPolicyPayload,
    }),
    addOptionalFile(stores, {
      id: 'policies.pending',
      filePath: path.join(sourceRoot, 'policies', 'pending.json'),
      acceptsLegacyPayload: acceptsPendingPolicyPayload,
    }),
    addOptionalFile(stores, {
      id: 'operators.founder',
      filePath: path.join(sourceRoot, 'operators.json'),
      acceptsLegacyPayload: acceptsOperatorPayload,
    }),
    addOptionalFile(stores, {
      id: 'settings.app',
      filePath: path.join(sourceRoot, 'settings', 'app-settings.json'),
      acceptsLegacyPayload: acceptsSettingsPayload,
    }),
    addOptionalFile(stores, {
      id: 'machines.registry',
      filePath: path.join(sourceRoot, 'machines.json'),
      acceptsLegacyPayload: hasArrayField('machines'),
    }),
  ])

  return stores.sort((left, right) => left.filePath.localeCompare(right.filePath))
}

async function inspectStore(
  contract: JsonStoreContract,
  options: { migrateLegacy: boolean },
): Promise<HerdJsonStoreReadinessEntry> {
  const requiredSchemaVersion = JSON_STORE_SCHEMA_VERSION
  async function quarantineCorruptStore(reason: string): Promise<HerdJsonStoreReadinessEntry> {
    try {
      const quarantinePath = await quarantineJsonFile(contract.filePath)
      return {
        id: contract.id,
        path: contract.filePath,
        ready: true,
        schemaVersion: null,
        requiredSchemaVersion,
        migrationStatus: 'quarantined',
        error: `${reason}; quarantined to ${quarantinePath}`,
        quarantinePath,
      }
    } catch (quarantineError) {
      return {
        id: contract.id,
        path: contract.filePath,
        ready: false,
        schemaVersion: null,
        requiredSchemaVersion,
        migrationStatus: 'unwritable',
        error: `${reason}; quarantine failed: ${quarantineError instanceof Error ? quarantineError.message : String(quarantineError)}`,
      }
    }
  }

  const fileStatus = await pathIsFile(contract.filePath)
  if (fileStatus === false) {
    return {
      id: contract.id,
      path: contract.filePath,
      ready: false,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'corrupt',
      error: 'JSON store path exists but is not a regular file.',
    }
  }
  if (fileStatus === 'missing') {
    return {
      id: contract.id,
      path: contract.filePath,
      ready: true,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'ready',
      error: null,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(contract.filePath, 'utf8')) as unknown
  } catch (error) {
    if (contract.corruptPolicy === 'quarantine') {
      return quarantineCorruptStore(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return {
      id: contract.id,
      path: contract.filePath,
      ready: false,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'corrupt',
      error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (!isObject(parsed)) {
    if (contract.corruptPolicy === 'quarantine') {
      return quarantineCorruptStore('JSON store root must be an object')
    }
    return {
      id: contract.id,
      path: contract.filePath,
      ready: false,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'corrupt',
      error: 'JSON store root must be an object.',
    }
  }

  const schemaVersion = parsed.schemaVersion
  if (schemaVersion !== undefined) {
    if (schemaVersion !== requiredSchemaVersion) {
      return {
        id: contract.id,
        path: contract.filePath,
        ready: false,
        schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : null,
        requiredSchemaVersion,
        migrationStatus: 'stale',
        error: `schemaVersion mismatch: found ${String(schemaVersion)}, required ${requiredSchemaVersion}.`,
      }
    }
    if (!contract.acceptsLegacyPayload(parsed)) {
      if (contract.corruptPolicy === 'quarantine') {
        return quarantineCorruptStore('JSON store has the current schemaVersion but does not match the expected store shape')
      }
      return {
        id: contract.id,
        path: contract.filePath,
        ready: false,
        schemaVersion: requiredSchemaVersion,
        requiredSchemaVersion,
        migrationStatus: 'corrupt',
        error: 'JSON store has the current schemaVersion but does not match the expected store shape.',
      }
    }
    return {
      id: contract.id,
      path: contract.filePath,
      ready: true,
      schemaVersion: requiredSchemaVersion,
      requiredSchemaVersion,
      migrationStatus: 'ready',
      error: null,
    }
  }

  if (!contract.acceptsLegacyPayload(parsed)) {
    if (contract.corruptPolicy === 'quarantine') {
      return quarantineCorruptStore('JSON store is missing schemaVersion and does not match a known legacy shape')
    }
    return {
      id: contract.id,
      path: contract.filePath,
      ready: false,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'corrupt',
      error: 'JSON store is missing schemaVersion and does not match a known legacy shape.',
    }
  }

  if (!options.migrateLegacy) {
    return {
      id: contract.id,
      path: contract.filePath,
      ready: false,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'stale',
      error: 'JSON store is missing schemaVersion. Run store:ready without --no-migrate to tag the legacy store.',
    }
  }

  try {
    await writeJsonFileAtomically(
      contract.filePath,
      withJsonStoreSchema(parsed),
      { trailingNewline: true },
    )
  } catch (error) {
    return {
      id: contract.id,
      path: contract.filePath,
      ready: false,
      schemaVersion: null,
      requiredSchemaVersion,
      migrationStatus: 'unwritable',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  return {
    id: contract.id,
    path: contract.filePath,
    ready: true,
    schemaVersion: requiredSchemaVersion,
    requiredSchemaVersion,
    migrationStatus: 'migrated',
    error: null,
  }
}

function aggregateStatus(
  entries: readonly HerdJsonStoreReadinessEntry[],
): HerdJsonStoreMigrationStatus {
  const failed = entries.find((entry) => !entry.ready)
  if (failed) {
    return failed.migrationStatus
  }
  if (entries.some((entry) => entry.migrationStatus === 'quarantined')) {
    return 'quarantined'
  }
  return entries.some((entry) => entry.migrationStatus === 'migrated')
    ? 'migrated'
    : 'ready'
}

export async function inspectHerdJsonStoreReadiness(options: {
  env?: NodeJS.ProcessEnv
  sourceRoot?: string
  migrateLegacy?: boolean
} = {}): Promise<HerdJsonStoreReadiness> {
  const env = options.env ?? process.env
  const sourceRoot = resolveSourceRoot({ sourceRoot: options.sourceRoot, env })
  const contracts = await collectJsonStoreContracts({ sourceRoot, env })
  const stores = await Promise.all(
    contracts.map((contract) => inspectStore(contract, {
      migrateLegacy: options.migrateLegacy !== false,
    })),
  )
  const migrationStatus = aggregateStatus(stores)
  const ready = stores.every((entry) => entry.ready)
  const firstError = stores.find((entry) => !entry.ready)?.error ?? null

  return {
    ready,
    sourceRoot,
    requiredSchemaVersion: JSON_STORE_SCHEMA_VERSION,
    migrationStatus,
    stores,
    error: firstError,
  }
}

export async function ensureHerdJsonStoresReadyForBoot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HerdJsonStoreReadiness> {
  const readiness = await inspectHerdJsonStoreReadiness({
    env,
    migrateLegacy: true,
  })
  if (!readiness.ready) {
    throw new HerdJsonStoresNotReadyError(readiness)
  }
  return readiness
}
