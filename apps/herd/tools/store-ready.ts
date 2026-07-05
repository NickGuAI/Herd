#!/usr/bin/env tsx
import { inspectHerdJsonStoreReadiness } from '../server/json-store-readiness.js'

function usage(): string {
  return [
    'Usage: pnpm --filter herd run store:ready -- [--source-root <dir>] [--no-migrate]',
    '',
    'Checks the Herd JSON data stores. Legacy stores are tagged with schemaVersion by default.',
  ].join('\n')
}

function parseArgs(argv: string[]): {
  sourceRoot?: string
  migrateLegacy: boolean
} {
  const parsed: {
    sourceRoot?: string
    migrateLegacy: boolean
  } = {
    migrateLegacy: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--source-root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--source-root requires a value')
      parsed.sourceRoot = value
      index += 1
      continue
    }
    if (arg === '--no-migrate') {
      parsed.migrateLegacy = false
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return parsed
}

try {
  const args = parseArgs(process.argv.slice(2))
  const readiness = await inspectHerdJsonStoreReadiness({
    sourceRoot: args.sourceRoot,
    migrateLegacy: args.migrateLegacy,
  })
  if (!readiness.ready) {
    console.error('[store:ready] JSON data stores are not ready.')
    console.error(`status: ${readiness.migrationStatus}`)
    console.error(`data dir: ${readiness.sourceRoot}`)
    console.error(`required schema: ${readiness.requiredSchemaVersion}`)
    for (const store of readiness.stores.filter((entry) => !entry.ready)) {
      console.error(`${store.id}: ${store.migrationStatus} at ${store.path}`)
      if (store.error) {
        console.error(store.error)
      }
    }
    process.exit(1)
  }
  console.log(
    `[store:ready] JSON data stores ready at ${readiness.sourceRoot} `
    + `(${readiness.migrationStatus}; ${readiness.stores.length} checked)`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
