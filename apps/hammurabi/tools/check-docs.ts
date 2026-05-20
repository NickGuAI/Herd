import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadHammurabiModules } from '../server/module-loader.js'
import { HAMMURABI_MODULE_GRAPH } from '../src/module-manifest.js'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(toolDir, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const docsRoot = path.join(appRoot, 'docs')

const failures: string[] = []

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/')
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

function fail(message: string): void {
  failures.push(message)
}

function assertContains(haystack: string, needle: string, context: string): void {
  if (!haystack.includes(needle)) {
    fail(`${context} is missing ${needle}`)
  }
}

function moduleDirectories(): string[] {
  return readdirSync(path.join(appRoot, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function checkMarkdownLinks(filePath: string): void {
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
    }
  }
}

function checkDocsIndex(): void {
  const llmsPath = path.join(docsRoot, 'llms.txt')
  const directoryPath = path.join(docsRoot, 'docs-directory.md')
  const llms = readText(llmsPath)

  checkMarkdownLinks(llmsPath)
  checkMarkdownLinks(directoryPath)

  for (const moduleName of moduleDirectories()) {
    assertContains(llms, `modules/${moduleName}`, 'llms.txt module inventory')
  }
}

function checkModuleInventory(): void {
  const modules = moduleDirectories()
  const graphDirectories = HAMMURABI_MODULE_GRAPH.map((entry) => entry.directory).sort()
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
      `root="apps/hammurabi/modules/${moduleName}"`,
      'module-index.xml source inventory',
    )
    assertContains(
      moduleIndex,
      `<module id="${moduleName}"`,
      'module-index.xml module entries',
    )
  }
}

function checkRouteMap(): void {
  const routesDoc = readText(path.join(docsRoot, 'architecture', 'routes-and-apis.md'))
  const loadedModules = loadHammurabiModules()

  for (const route of loadedModules.mountPlan.routes) {
    assertContains(routesDoc, route.id, 'routes-and-apis.md route ids')
    assertContains(routesDoc, route.mount, 'routes-and-apis.md route mounts')
  }

  for (const socket of loadedModules.mountPlan.websockets) {
    assertContains(routesDoc, socket.id, 'routes-and-apis.md websocket ids')
    assertContains(routesDoc, socket.path, 'routes-and-apis.md websocket paths')
  }
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
    path.join(repoRoot, '.github', 'workflows'),
  ]

  const forbiddenPatterns = [
    {
      pattern: /apps\/hammurabi\/(?:scripts|migrations|agents)/u,
      label: 'retired app root path',
    },
    {
      pattern: /agents\/terminal_bench/u,
      label: 'retired app-root Terminal Bench path',
    },
    {
      pattern: /from\s+['"][^'"]*migrations/u,
      label: 'migration import',
    },
    {
      pattern: /\.\/scripts\//u,
      label: 'app scripts path dependency',
    },
  ]

  for (const filePath of scanTargets.flatMap((target) => walkFiles(target))) {
    const source = readText(filePath)
    for (const { pattern, label } of forbiddenPatterns) {
      if (pattern.test(source)) {
        fail(`${relative(filePath)} contains ${label}`)
      }
    }
  }
}

function checkGuardrailDocumentation(): void {
  const command = 'pnpm --filter hammurabi run docs:check'
  assertContains(readText(path.join(docsRoot, 'docs-directory.md')), command, 'docs-directory.md')
  assertContains(readText(path.join(repoRoot, '.claude', 'rules', 'hammurabi.md')), command, '.claude/rules/hammurabi.md')
}

checkDocsIndex()
checkModuleInventory()
checkRouteMap()
checkForbiddenRoots()
checkGuardrailDocumentation()

if (failures.length > 0) {
  console.error('Hammurabi docs guardrail failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Hammurabi docs guardrail passed.')
