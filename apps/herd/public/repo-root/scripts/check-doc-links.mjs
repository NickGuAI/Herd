#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const docsRoot = path.join(root, 'docs')
const targets = [path.join(root, 'README.md')]

function collectMarkdown(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMarkdown(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      targets.push(fullPath)
    }
  }
}

function isExternalLink(href) {
  return /^(https?:|mailto:|tel:)/i.test(href)
}

function stripFragment(href) {
  return href.split('#')[0]
}

function linkTargetExists(sourceFile, href) {
  const withoutFragment = stripFragment(href)
  if (!withoutFragment) {
    return true
  }
  const baseDir = path.dirname(sourceFile)
  const candidate = path.resolve(baseDir, decodeURIComponent(withoutFragment))
  return existsSync(candidate)
}

if (!existsSync(path.join(root, 'README.md'))) {
  console.error('README.md is required')
  process.exit(1)
}
if (!existsSync(docsRoot)) {
  console.error('docs/ is required')
  process.exit(1)
}

collectMarkdown(docsRoot)

const failures = []
const markdownLinkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

for (const file of targets) {
  const content = readFileSync(file, 'utf8')
  for (const match of content.matchAll(markdownLinkPattern)) {
    const href = match[1]
    if (isExternalLink(href)) {
      continue
    }
    if (!linkTargetExists(file, href)) {
      failures.push(`${path.relative(root, file)} -> ${href}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Broken local docs links:')
  for (const failure of failures) {
    console.error(`  ${failure}`)
  }
  process.exit(1)
}

console.log(`Checked ${targets.length} markdown files for local docs links.`)
