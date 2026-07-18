import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { HerdStorageOwnership } from '../src/types/module-manifest.js'
import { findForbiddenRootReferenceLabels } from './forbidden-root-references.js'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(toolDir, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const sourceDocsRoot = path.join(appRoot, 'docs')
const publicReleaseDocsRoot = path.join(repoRoot, 'docs')
const hasSourceDocsRoot = existsSync(sourceDocsRoot)
const docsRoot = hasSourceDocsRoot ? sourceDocsRoot : publicReleaseDocsRoot
const publicReleaseDocsOnly = !hasSourceDocsRoot && existsSync(publicReleaseDocsRoot)

const failures: string[] = []
const ACTION_POLICY_MATCHERS_START = '<!-- BEGIN GENERATED ACTION POLICY MATCHERS -->'
const ACTION_POLICY_MATCHERS_END = '<!-- END GENERATED ACTION POLICY MATCHERS -->'

type BuiltInActionForDocs = {
  id: string
  matchers: {
    mcpServers: readonly string[]
    mcpTools?: readonly string[]
    bashPatterns: readonly RegExp[]
  }
}

type ActionPolicyDocsRegistry = {
  builtInActions: readonly BuiltInActionForDocs[]
  internalEditInCwdActionId: string
  internalSafeBashActionId: string
  internalSafeMcpActionId: string
  safeBashPatterns: readonly RegExp[]
}

const requiredPublicDocs = [
  'getting-started/quickstart.md',
  'concepts/commanders.md',
  'concepts/org.md',
  'concepts/workers.md',
  'concepts/command-room.md',
  'concepts/approvals.md',
  'operate/provider-auth.md',
  'operate/credential-pools.md',
  'operate/machines.md',
  'operate/hardening.md',
  'operate/enterprise-ec2.md',
  'operate/uninstall.md',
  'operate/workspace.md',
  'operate/channels.md',
  'reference/cli.md',
  'reference/api.md',
  'reference/platforms.md',
  'reference/naming.md',
  'troubleshoot.md',
]

const publicDocsRootFiles = [
  'index.md',
  'llms.txt',
  'docs-directory.md',
  'troubleshoot.md',
]

const publicDocsDirectories = [
  'getting-started',
  'concepts',
  'guides',
  'operate',
  'reference',
]

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/')
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

function fail(message: string): void {
  failures.push(message)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function assertContains(haystack: string, needle: string, context: string): void {
  if (!haystack.includes(needle)) {
    fail(`${context} is missing ${needle}`)
  }
}

function assertExists(filePath: string, context: string): void {
  if (!existsSync(filePath)) {
    fail(`${context} is missing ${relative(filePath)}`)
  }
}

function docsRelative(filePath: string): string {
  return path.relative(docsRoot, filePath).replaceAll(path.sep, '/')
}

function isInsideDirectory(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
  )
}

function isPublishedPublicDocTarget(filePath: string): boolean {
  if (!isInsideDirectory(filePath, docsRoot)) {
    return false
  }

  const docsPath = docsRelative(filePath)
  if (publicDocsRootFiles.includes(docsPath)) {
    return true
  }

  const [topLevel] = docsPath.split('/')
  return publicDocsDirectories.includes(topLevel)
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll('|', '\\|')
}

function formatCodeList(values: readonly string[]): string {
  if (values.length === 0) {
    return 'none'
  }
  return values.map((value) => `\`${escapeMarkdownTableCell(value)}\``).join(', ')
}

function formatPatternList(patterns: readonly RegExp[]): string {
  if (patterns.length === 0) {
    return 'none'
  }
  return patterns
    .map((pattern) => `\`${escapeMarkdownTableCell(pattern.toString())}\``)
    .join('; ')
}

function formatMcpMatcherCell(action: BuiltInActionForDocs, registry: ActionPolicyDocsRegistry): string {
  if (action.id === registry.internalSafeMcpActionId) {
    return 'unmatched MCP servers except `codex_apps` and `opencode`'
  }

  const parts: string[] = []
  if (action.matchers.mcpServers.length > 0) {
    parts.push(`servers: ${formatCodeList(action.matchers.mcpServers)}`)
  }
  if ((action.matchers.mcpTools ?? []).length > 0) {
    parts.push(`tools: ${formatCodeList(action.matchers.mcpTools ?? [])}`)
  }
  return parts.length > 0 ? parts.join('; ') : 'none'
}

function formatBashMatcherCell(action: BuiltInActionForDocs, registry: ActionPolicyDocsRegistry): string {
  if (action.id === registry.internalEditInCwdActionId) {
    return 'Fast path only when the Edit/Write target or target parent realpaths inside the session cwd, or matches this action record\'s explicit allowlist.'
  }

  if (action.id === registry.internalSafeBashActionId) {
    return `${formatPatternList(registry.safeBashPatterns)}. Every parsed path argument, action-specific path operand, and redirect target must realpath inside the session cwd, or match this action record's explicit allowlist. Find command, mutation, or file-output actions (\`-exec\`, \`-execdir\`, \`-ok\`, \`-okdir\`, \`-delete\`, \`-fprint\`, \`-fprint0\`, \`-fprintf\`, \`-fls\`) fall back to review. Unparseable shell syntax falls back to review.`
  }

  if (action.id === registry.internalSafeMcpActionId) {
    return 'none'
  }

  return formatPatternList(action.matchers.bashPatterns)
}

function renderActionPolicyMatcherDocsBlock(registry: ActionPolicyDocsRegistry): string {
  const rows = registry.builtInActions
    .map((action) => `| \`${action.id}\` | ${formatMcpMatcherCell(action, registry)} | ${formatBashMatcherCell(action, registry)} |`)
    .join('\n')

  return [
    ACTION_POLICY_MATCHERS_START,
    'Generated and verified from [`registry.ts`](../../modules/policies/registry.ts) by `pnpm --filter herd docs:check`.',
    '',
    '| Action | MCP matchers | Bash matchers |',
    '|---|---|---|',
    rows,
    '',
    ACTION_POLICY_MATCHERS_END,
  ].join('\n')
}

async function checkActionPolicyMatcherDocumentation(): Promise<void> {
  const policyRegistry = await import('../modules/policies/registry.js')
  const registry: ActionPolicyDocsRegistry = {
    builtInActions: policyRegistry.BUILT_IN_ACTIONS,
    internalEditInCwdActionId: policyRegistry.INTERNAL_EDIT_IN_CWD_ACTION.id,
    internalSafeBashActionId: policyRegistry.INTERNAL_SAFE_BASH_ACTION.id,
    internalSafeMcpActionId: policyRegistry.INTERNAL_SAFE_MCP_ACTION.id,
    safeBashPatterns: policyRegistry.SAFE_BASH_PATTERNS,
  }
  const approvalsPath = path.join(docsRoot, 'features', 'approvals.md')
  const source = readText(approvalsPath)
  const startIndex = source.indexOf(ACTION_POLICY_MATCHERS_START)
  const endIndex = source.indexOf(ACTION_POLICY_MATCHERS_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    fail('features/approvals.md is missing the generated action policy matcher block')
    return
  }

  const actual = source.slice(startIndex, endIndex + ACTION_POLICY_MATCHERS_END.length)
  const expected = renderActionPolicyMatcherDocsBlock(registry)
  if (actual !== expected) {
    fail('features/approvals.md generated action policy matcher block is out of sync with modules/policies/registry.ts')
  }
}

function moduleDirectories(): string[] {
  return readdirSync(path.join(appRoot, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
    .map((entry) => entry.name)
    .sort()
}

function checkMarkdownLinks(filePath: string, options: { publicDocsOnly?: boolean } = {}): void {
  const source = readText(filePath)
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g
  const baseDir = path.dirname(filePath)

  for (const match of source.matchAll(linkPattern)) {
    const rawTarget = match[1].trim()
    if (
      rawTarget.startsWith('#')
      || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)
    ) {
      continue
    }

    const targetWithoutAnchor = rawTarget.split('#')[0].split('?')[0]
    if (!targetWithoutAnchor) {
      continue
    }

    const resolved = path.resolve(baseDir, targetWithoutAnchor)
    if (!existsSync(resolved)) {
      fail(`${relative(filePath)} links missing target ${rawTarget}`)
      continue
    }

    if (
      options.publicDocsOnly &&
      isInsideDirectory(resolved, docsRoot) &&
      !isPublishedPublicDocTarget(resolved)
    ) {
      fail(`${relative(filePath)} links internal-only docs target ${rawTarget}`)
    }
  }
}

function publicMarkdownFiles(): string[] {
  const files = publicDocsRootFiles.map((file) => path.join(docsRoot, file))
  for (const directory of publicDocsDirectories) {
    const directoryPath = path.join(docsRoot, directory)
    for (const filePath of walkFiles(directoryPath)) {
      if (/\.(?:md|txt)$/u.test(filePath)) {
        files.push(filePath)
      }
    }
  }
  return [...new Set(files)].sort()
}

function checkPublicMarkdownLinkIntegrity(): void {
  for (const filePath of publicMarkdownFiles()) {
    checkMarkdownLinks(filePath, { publicDocsOnly: true })
  }
}

function checkPublicRootMarkdownLinks(filePath: string): void {
  if (!existsSync(filePath)) {
    fail(`public root markdown target is missing ${relative(filePath)}`)
    return
  }

  const source = readText(filePath)
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g

  for (const match of source.matchAll(linkPattern)) {
    const rawTarget = match[1].trim()
    const targetWithoutAnchor = rawTarget.split('#')[0].split('?')[0]
    if (!targetWithoutAnchor) {
      continue
    }

    let docsTarget: string | null = null
    if (targetWithoutAnchor.startsWith('./docs/')) {
      docsTarget = targetWithoutAnchor.slice('./docs/'.length)
    } else if (targetWithoutAnchor.startsWith('docs/')) {
      docsTarget = targetWithoutAnchor.slice('docs/'.length)
    } else if (targetWithoutAnchor.startsWith('https://herd.gehirn.ai/docs/')) {
      docsTarget = targetWithoutAnchor.slice('https://herd.gehirn.ai/docs/'.length)
    } else if (targetWithoutAnchor === 'https://herd.gehirn.ai/docs') {
      docsTarget = 'index.md'
    } else if (targetWithoutAnchor.startsWith('https://herd.gehirn.ai/docs/')) {
      docsTarget = targetWithoutAnchor.slice('https://herd.gehirn.ai/docs/'.length)
    } else if (targetWithoutAnchor === 'https://herd.gehirn.ai/docs') {
      docsTarget = 'index.md'
    }

    if (targetWithoutAnchor === './SECURITY.md' || targetWithoutAnchor === 'SECURITY.md') {
      const resolved = publicSecurityPolicyPath()
      if (!existsSync(resolved)) {
        fail(`${relative(filePath)} links missing published security target ${rawTarget}`)
      }
      continue
    }

    if (!docsTarget) {
      continue
    }

    if (!path.extname(docsTarget)) {
      docsTarget = path.join(docsTarget, 'index.md')
    }

    const resolved = path.join(docsRoot, docsTarget)
    if (!existsSync(resolved)) {
      fail(`${relative(filePath)} links missing published docs target ${rawTarget}`)
    }
  }
}

function publicReadmePath(): string {
  return publicReleaseDocsOnly
    ? path.join(repoRoot, 'README.md')
    : path.join(appRoot, 'public', 'repo-root', 'README.md')
}

function publicRootFilePath(fileName: string): string {
  return publicReleaseDocsOnly
    ? path.join(repoRoot, fileName)
    : path.join(appRoot, 'public', 'repo-root', fileName)
}

function checkPublicReadmeDocsLinks(): void {
  checkPublicRootMarkdownLinks(publicReadmePath())
  checkPublicRootMarkdownLinks(publicSecurityPolicyPath())
}

function checkDocsIndex(): void {
  const llmsPath = path.join(docsRoot, 'llms.txt')
  const directoryPath = path.join(docsRoot, 'docs-directory.md')
  const indexPath = path.join(docsRoot, 'index.md')
  const llms = readText(llmsPath)
  const directory = readText(directoryPath)
  const index = readText(indexPath)

  checkPublicMarkdownLinkIntegrity()
  checkPublicReadmeDocsLinks()

  for (const doc of requiredPublicDocs) {
    assertExists(path.join(docsRoot, doc), 'public docs IA')
    assertContains(index, doc, 'index.md public docs IA')
    assertContains(llms, doc, 'llms.txt public docs IA')
    assertContains(directory, doc, 'docs-directory.md public docs IA')
  }

  for (const heading of ['## Setup', '## Concepts', '## Operations', '## Reference']) {
    assertContains(llms, heading, 'llms.txt grouped discovery headings')
  }

  if (/Source And Runtime|module-index\.xml|architecture\//u.test(llms)) {
    fail('llms.txt must expose only public Herd docs, not source/runtime maps')
  }
  if (/Source And Runtime|module-index\.xml|architecture\//u.test(directory)) {
    fail('docs-directory.md must expose only public Herd docs, not source/runtime maps')
  }
}

function publicSecurityPolicyPath(): string {
  return publicReleaseDocsOnly
    ? path.join(repoRoot, 'SECURITY.md')
    : path.join(appRoot, 'public', 'repo-root', 'SECURITY.md')
}

function checkSecurityPolicy(): void {
  const securityPath = publicSecurityPolicyPath()
  assertExists(securityPath, 'public SECURITY.md')
  if (!existsSync(securityPath)) {
    return
  }

  const security = readText(securityPath)
  for (const required of [
    '## Supported Versions',
    '## Reporting A Vulnerability',
    '## Threat Model Summary',
    'bootstrap key',
    'Agent Execution',
    'Approval Gating',
    'open-source',
    'GNU Affero General Public License',
    'AGPL-3.0-only',
  ]) {
    assertContains(security, required, 'public SECURITY.md')
  }
}

async function checkModuleInventory(): Promise<void> {
  const { HERD_MODULE_GRAPH } = await import('../src/module-manifest.js')
  const modules = moduleDirectories()
  const graphDirectories = HERD_MODULE_GRAPH.map((entry) => entry.directory).sort()
  const moduleIndexPath = path.join(docsRoot, 'module-index.xml')
  const moduleIndex = readText(moduleIndexPath)

  if (JSON.stringify(graphDirectories) !== JSON.stringify(modules)) {
    fail(`browser module graph directories do not match modules root: ${graphDirectories.join(', ')}`)
  }

  const inventoryMatch = moduleIndex.match(/<moduleSourceInventory count="(\d+)">/u)
  if (!inventoryMatch) {
    fail('module-index.xml is missing moduleSourceInventory count')
  } else if (Number(inventoryMatch[1]) !== modules.length) {
    fail(`module-index.xml inventory count ${inventoryMatch[1]} does not match ${modules.length} module directories`)
  }

  for (const moduleName of modules) {
    assertContains(
      moduleIndex,
      `root="apps/herd/modules/${moduleName}"`,
      'module-index.xml source inventory',
    )
    assertContains(
      moduleIndex,
      `<module id="${moduleName}"`,
      'module-index.xml module entries',
    )
  }
}

async function checkRouteMap(): Promise<void> {
  const { loadHerdModules } = await import('../server/module-loader.js')
  const routesDoc = readText(path.join(docsRoot, 'architecture', 'routes-and-apis.md'))
  const loadedModules = loadHerdModules()

  for (const route of loadedModules.mountPlan.routes) {
    assertContains(routesDoc, route.id, 'routes-and-apis.md route ids')
    assertContains(routesDoc, route.mount, 'routes-and-apis.md route mounts')
  }

  for (const socket of loadedModules.mountPlan.websockets) {
    assertContains(routesDoc, socket.id, 'routes-and-apis.md websocket ids')
    assertContains(routesDoc, socket.path, 'routes-and-apis.md websocket paths')
  }
}

function splitCommaSeparatedAttribute(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function dataAttribute(source: string, attributeName: string): string | null {
  const pattern = new RegExp(`\\b${escapeRegExp(attributeName)}="([^"]*)"`, 'u')
  return source.match(pattern)?.[1] ?? null
}

function assertSameSet(
  actual: readonly string[],
  expected: readonly string[],
  context: string,
): void {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${context} is out of sync: expected ${expectedSorted.join(', ')}; found ${actualSorted.join(', ')}`)
  }
}

async function checkDiagramManifestReconciliation(): Promise<void> {
  const { loadHerdModules } = await import('../server/module-loader.js')
  const { HERD_MODULE_GRAPH } = await import('../src/module-manifest.js')
  const loadedModules = loadHerdModules()
  const moduleOverviewPath = path.join(docsRoot, 'diagrams', 'modules', 'module-concepts-overview.svg')
  const moduleOverview = readText(moduleOverviewPath)
  const moduleInventory = dataAttribute(moduleOverview, 'data-herd-module-inventory')
  if (!moduleInventory) {
    fail(`${relative(moduleOverviewPath)} is missing data-herd-module-inventory`)
  } else {
    assertSameSet(
      splitCommaSeparatedAttribute(moduleInventory),
      HERD_MODULE_GRAPH.map((entry) => entry.id),
      `${relative(moduleOverviewPath)} module inventory`,
    )
  }
  if (/\bservices\b/u.test(moduleOverview)) {
    fail(`${relative(moduleOverviewPath)} still references the retired services module`)
  }

  const routeDiagramPath = path.join(docsRoot, 'diagrams', 'architecture', 'ui-to-backend-logic-flow.dot')
  const routeDiagram = readText(routeDiagramPath)
  for (const route of loadedModules.mountPlan.routes) {
    assertContains(routeDiagram, route.mount, `${relative(routeDiagramPath)} route mounts`)
  }
  for (const websocket of loadedModules.mountPlan.websockets) {
    assertContains(routeDiagram, websocket.path, `${relative(routeDiagramPath)} websocket paths`)
  }

  const parserDiagramPath = path.join(docsRoot, 'diagrams', 'modules', 'module-graph-and-parsers.svg')
  const parserDiagram = readText(parserDiagramPath)
  const socketInventory = dataAttribute(parserDiagram, 'data-herd-websocket-paths')
  if (!socketInventory) {
    fail(`${relative(parserDiagramPath)} is missing data-herd-websocket-paths`)
  } else {
    assertSameSet(
      splitCommaSeparatedAttribute(socketInventory),
      loadedModules.mountPlan.websockets.map((websocket) => websocket.path),
      `${relative(parserDiagramPath)} websocket inventory`,
    )
  }
}

function moduleIndexBlock(moduleIndex: string, moduleId: string): string {
  const pattern = new RegExp(
    `<module id="${escapeRegExp(moduleId)}"[^>]*>[\\s\\S]*?\\n    </module>`,
    'u',
  )
  const match = moduleIndex.match(pattern)
  if (!match) {
    fail(`module-index.xml is missing runtime module entry ${moduleId}`)
    return ''
  }
  return match[0]
}

function tagAttribute(block: string, tagName: string, attributeName: string): string {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\b${attributeName}="([^"]*)"`, 'u')
  return block.match(pattern)?.[1] ?? ''
}

function splitSpaceSeparatedAttribute(value: string): readonly string[] {
  return value
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== 'none')
}

function joinStoragePath(root: string, file: string): string {
  if (!root) {
    return file
  }
  if (!file) {
    return root
  }
  return `${root.replace(/\/+$/u, '')}/${file.replace(/^\/+/u, '')}`
}

function expandedStoragePaths(storage: HerdStorageOwnership): readonly string[] {
  const paths = new Set<string>([...storage.roots, ...storage.files])
  for (const root of storage.roots) {
    for (const file of storage.files) {
      paths.add(joinStoragePath(root, file))
    }
  }
  return [...paths].sort()
}

function toHerdDataTemplate(filePath: string, dataRoot: string): string {
  const normalizedFilePath = path.resolve(filePath).replaceAll(path.sep, '/')
  const normalizedDataRoot = path.resolve(dataRoot).replaceAll(path.sep, '/')
  if (normalizedFilePath === normalizedDataRoot) {
    return '${HERD_DATA_DIR}'
  }
  if (normalizedFilePath.startsWith(`${normalizedDataRoot}/`)) {
    return `\${HERD_DATA_DIR}/${normalizedFilePath.slice(normalizedDataRoot.length + 1)}`
  }
  return normalizedFilePath
}

async function checkRuntimeManifestReconciliation(): Promise<void> {
  const { loadHerdModules } = await import('../server/module-loader.js')
  const { createModules } = await import('../server/module-registry.js')
  const { openHerdSqliteDatabase } = await import('../server/db/connection.js')
  const { applyHerdSqliteSchema } = await import('../server/db/schema.js')
  const { defaultMachineRegistryStorePath } = await import('../modules/agents/machines.js')
  const { resolveAutomationsDataDir } = await import('../modules/data-dir.js')
  const { defaultOrgIdentityStorePath } = await import('../modules/org-identity/store.js')
  const { defaultAppSettingsStorePath } = await import('../modules/settings/store.js')
  const moduleIndexPath = path.join(docsRoot, 'module-index.xml')
  const moduleIndex = readText(moduleIndexPath)
  const loadedModules = loadHerdModules()
  const sqliteTempDir = mkdtempSync(path.join(tmpdir(), 'herd-docs-check-'))
  const sqliteDb = openHerdSqliteDatabase(path.join(sqliteTempDir, 'herd.sqlite'))
  applyHerdSqliteSchema(sqliteDb)
  const runtime = createModules({
    initializeAgentSessionRuntimes: false,
    initializeAutomationScheduler: false,
    initializeChannelRuntimes: false,
    maxAgentSessions: 1,
    sqliteDb,
  })
  const { capabilities } = runtime

  for (const [capabilityId, ownerModuleId] of capabilities.providers) {
    const manifest = loadedModules.manifestById.get(ownerModuleId)
    if (!manifest) {
      continue
    }
    if (!manifest.graph.capabilities.provides.includes(capabilityId)) {
      fail(`Runtime module ${ownerModuleId} provides ${capabilityId} but the manifest does not declare it`)
    }

    const moduleBlock = moduleIndexBlock(moduleIndex, ownerModuleId)
    const documentedProvides = splitSpaceSeparatedAttribute(tagAttribute(moduleBlock, 'capabilities', 'provides'))
    if (!documentedProvides.includes(capabilityId)) {
      fail(`module-index.xml ${ownerModuleId} capabilities provides is missing ${capabilityId}`)
    }
  }

  for (const [capabilityId, consumerModuleIds] of capabilities.consumers) {
    const providerModuleId = capabilities.providers.get(capabilityId)
    for (const consumerModuleId of consumerModuleIds) {
      if (consumerModuleId === providerModuleId) {
        continue
      }

      const manifest = loadedModules.manifestById.get(consumerModuleId)
      if (!manifest) {
        continue
      }

      if (!manifest.graph.capabilities.consumes.includes(capabilityId)) {
        fail(`Runtime module ${consumerModuleId} consumes ${capabilityId} but the manifest does not declare it`)
      }
      if (!manifest.graph.dependencies.capabilities.includes(capabilityId)) {
        fail(`Runtime module ${consumerModuleId} consumes ${capabilityId} but dependencies.capabilities omits it`)
      }

      const moduleBlock = moduleIndexBlock(moduleIndex, consumerModuleId)
      const documentedConsumes = splitSpaceSeparatedAttribute(tagAttribute(moduleBlock, 'capabilities', 'consumes'))
      if (!documentedConsumes.includes(capabilityId)) {
        fail(`module-index.xml ${consumerModuleId} capabilities consumes is missing ${capabilityId}`)
      }
    }
  }

  for (const manifest of loadedModules.manifests) {
    const moduleBlock = moduleIndexBlock(moduleIndex, manifest.graph.id)
    const documentedParserIds = splitSpaceSeparatedAttribute(tagAttribute(moduleBlock, 'parsers', 'ids'))
    for (const parser of manifest.server.parsers) {
      if (!documentedParserIds.includes(parser.id)) {
        fail(`module-index.xml ${manifest.graph.id} parsers ids is missing ${parser.id}`)
      }
    }

    const documentedWebsocketPaths = tagAttribute(moduleBlock, 'websockets', 'paths')
    for (const websocket of manifest.server.websockets) {
      if (!documentedWebsocketPaths.includes(websocket.path)) {
        fail(`module-index.xml ${manifest.graph.id} websockets paths is missing ${websocket.path}`)
      }
    }
  }

  const dataRoot = path.join(repoRoot, '.docs-check-herd-data')
  const env = {
    ...process.env,
    HERD_DATA_DIR: dataRoot,
  }
  const storagePathContracts = [
    {
      moduleId: 'agents',
      path: toHerdDataTemplate(defaultMachineRegistryStorePath(env), dataRoot),
    },
    {
      moduleId: 'automations',
      path: toHerdDataTemplate(resolveAutomationsDataDir(env), dataRoot),
    },
    {
      moduleId: 'org-identity',
      path: toHerdDataTemplate(defaultOrgIdentityStorePath(env), dataRoot),
    },
    {
      moduleId: 'settings',
      path: toHerdDataTemplate(defaultAppSettingsStorePath(env), dataRoot),
    },
  ]

  for (const contract of storagePathContracts) {
    const manifest = loadedModules.manifestById.get(contract.moduleId)
    if (!manifest) {
      fail(`storage path contract references missing module ${contract.moduleId}`)
      continue
    }
    const manifestStoragePaths = expandedStoragePaths(manifest.server.storage).join('; ')
    assertContains(
      manifestStoragePaths,
      contract.path,
      `${contract.moduleId} manifest storage paths`,
    )

    const moduleBlock = moduleIndexBlock(moduleIndex, contract.moduleId)
    const documentedStoragePaths = tagAttribute(moduleBlock, 'storage', 'paths')
    assertContains(
      documentedStoragePaths,
      contract.path,
      `module-index.xml ${contract.moduleId} storage paths`,
    )
  }

  const shutdownResults = await Promise.allSettled(runtime.modules.map(async (module) => {
    await module.shutdown?.()
  }))
  for (const result of shutdownResults) {
    if (result.status === 'rejected') {
      const detail = result.reason instanceof Error ? result.reason.message : String(result.reason)
      fail(`runtime snapshot shutdown failed: ${detail}`)
    }
  }

  sqliteDb.close()
  rmSync(sqliteTempDir, { recursive: true, force: true })
}

function walkFiles(start: string, files: string[] = []): string[] {
  if (!existsSync(start)) {
    return files
  }

  const stat = statSync(start)
  if (stat.isFile()) {
    files.push(start)
    return files
  }

  for (const entry of readdirSync(start, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules'
      || entry.name === 'dist'
      || entry.name === 'dist-server'
      || entry.name === '.git'
    ) {
      continue
    }
    walkFiles(path.join(start, entry.name), files)
  }

  return files
}

function checkForbiddenRoots(): void {
  for (const deletedRoot of ['scripts', 'migrations']) {
    const fullPath = path.join(appRoot, deletedRoot)
    if (existsSync(fullPath)) {
      fail(`deleted root exists: ${relative(fullPath)}`)
    }
  }

  const retiredAgentsRoot = path.join(appRoot, 'agents')
  if (existsSync(retiredAgentsRoot)) {
    fail(`retired product root exists: ${relative(retiredAgentsRoot)}`)
  }

  const scanTargets = [
    path.join(appRoot, 'package.json'),
    path.join(appRoot, 'src'),
    path.join(appRoot, 'server'),
    path.join(appRoot, 'modules'),
    path.join(appRoot, 'ios'),
    path.join(appRoot, 'public', 'repo-root'),
    path.join(repoRoot, 'packages', 'herd-cli', 'src', 'eval.ts'),
    path.join(repoRoot, '.github', 'workflows'),
  ]

  for (const filePath of scanTargets.flatMap((target) => walkFiles(target))) {
    const source = readText(filePath)
    for (const label of findForbiddenRootReferenceLabels({ appRoot, filePath, source })) {
      fail(`${relative(filePath)} contains ${label}`)
    }

    const isTestFixture = filePath.includes(`${path.sep}__tests__${path.sep}`)
      || /[.]test[.][cm]?[jt]sx?$/u.test(filePath)
    const isEvalRuntime = filePath.includes(`${path.sep}modules${path.sep}eval${path.sep}`)
      || filePath === path.join(repoRoot, 'packages', 'herd-cli', 'src', 'eval.ts')
    const legacyEvalProductName = ['Herd', 'Ath', 'ena'].join('')
    const legacyEvalSlug = ['herd-', 'ath', 'ena'].join('')
    const legacyEvalRole = ['ath', 'ena'].join('')
    const containsLegacyEvalIdentity = source.includes(legacyEvalProductName)
      || source.includes(legacyEvalSlug)
      || (isEvalRuntime && new RegExp(`\\b${legacyEvalRole}\\b`, 'u').test(source))
    if (!isTestFixture && containsLegacyEvalIdentity) {
      fail(`${relative(filePath)} contains contiguous legacy eval identity`)
    }
    if (!isTestFixture && /\/home\/(?:builder|builder)\/App\/benchmarks/u.test(source)) {
      fail(`${relative(filePath)} contains host-specific benchmark root`)
    }
  }
}

function checkGuardrailDocumentation(): void {
  const command = 'pnpm --filter herd run docs:check'
  assertContains(readText(path.join(repoRoot, '.claude', 'rules', 'herd.md')), command, '.claude/rules/herd.md')
}

function checkNamingPolicy(): void {
  const files = [
    path.join(docsRoot, 'index.md'),
    path.join(docsRoot, 'llms.txt'),
    path.join(docsRoot, 'docs-directory.md'),
    ...requiredPublicDocs.map((doc) => path.join(docsRoot, doc)),
    publicReadmePath(),
    publicSecurityPolicyPath(),
    ...[
      'CHANGELOG.md',
      'CLA.md',
      'COMMERCIAL-LICENSE.md',
      'CONTRIBUTING.md',
      'RELEASE_NOTES.md',
    ].map(publicRootFilePath),
  ]

  const deprecatedPublicName = ['Ham', 'murabi'].join('')
  const forbiddenPublicBranding = new RegExp([
    deprecatedPublicName,
    deprecatedPublicName.toLowerCase(),
    deprecatedPublicName.toUpperCase(),
    `X-${deprecatedPublicName}`,
  ].map(escapeRegExp).join('|'), 'u')
  const staleLicensePatterns = [
    { pattern: /\bsource-available\b/iu, label: 'stale source-available wording' },
    { pattern: /PolyForm/iu, label: 'stale PolyForm wording' },
    { pattern: /\bnoncommercial\b/iu, label: 'stale noncommercial-only wording' },
  ]

  for (const filePath of files) {
    if (!existsSync(filePath)) {
      fail(`public naming policy target is missing ${relative(filePath)}`)
      continue
    }
    readText(filePath).split(/\r?\n/u).forEach((line, index) => {
      if (forbiddenPublicBranding.test(line)) {
        fail(`${relative(filePath)}:${index + 1} contains deprecated public product wording`)
      }
      for (const { pattern, label } of staleLicensePatterns) {
        if (pattern.test(line)) {
          fail(`${relative(filePath)}:${index + 1} contains ${label}`)
        }
      }
    })
  }

  assertContains(readText(publicReadmePath()), 'AGPL-3.0-only', 'public README license contract')
  assertContains(readText(publicReadmePath()), 'commercial purposes', 'public README commercial-use contract')
  assertContains(readText(publicReadmePath()), 'No license purchase is required', 'public README no-purchase contract')
  assertContains(readText(publicReadmePath()), 'separate paid commercial agreement', 'public README paid-alternative contract')

  assertContains(
    readText(path.join(appRoot, 'src', 'App.tsx')),
    'Herd is reconnecting',
    'App auth recovery copy',
  )
  if (!publicReleaseDocsOnly) {
    assertContains(
      readText(path.join(appRoot, 'src', '__tests__', 'App.auth0.test.tsx')),
      'Herd is reconnecting',
      'App auth recovery copy test',
    )
  }
  assertContains(
    readText(path.join(docsRoot, 'reference', 'naming.md')),
    'Public docs and UI copy',
    'naming policy contract',
  )
}

async function main(): Promise<void> {
  checkDocsIndex()
  checkSecurityPolicy()
  checkForbiddenRoots()
  checkNamingPolicy()

  if (!publicReleaseDocsOnly) {
    await checkActionPolicyMatcherDocumentation()
    await checkModuleInventory()
    await checkRouteMap()
    await checkDiagramManifestReconciliation()
    await checkRuntimeManifestReconciliation()
    checkGuardrailDocumentation()
  }

  if (failures.length > 0) {
    console.error('Herd docs guardrail failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('Herd docs guardrail passed.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
