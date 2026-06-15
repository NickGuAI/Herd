import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const testDir = dirname(fileURLToPath(import.meta.url))
const srcDir = join(testDir, '..')
const appDir = join(srcDir, '..')

const auditedPaths = [
  join(appDir, 'modules/agents/components'),
  join(appDir, 'modules/commanders/components/CommanderIdentityTab.tsx'),
  join(appDir, 'modules/command-room'),
  join(appDir, 'modules/components'),
  join(appDir, 'modules/org'),
  join(appDir, 'modules/settings'),
  join(appDir, 'modules/workspace'),
  join(srcDir, 'components'),
  join(srcDir, 'index.css'),
]

const forbiddenSurfacePatterns: Array<[RegExp, string]> = [
  [/\btext-white\b/, 'text-white bypasses theme foreground tokens'],
  [/\bbg-black\b/, 'bg-black bypasses theme background tokens'],
  [/\bborder-white\b/, 'border-white bypasses theme border tokens'],
  [/\btext-zinc-[\w/-]+/, 'text-zinc bypasses Sumi-e foreground tokens'],
  [/\bdark:text-[\w/-]+/, 'dark:text bypasses shared light/dark tokens'],
  [/\b(?:bg-washi|text-sumi|border-ink|bg-sumi|text-washi|bg-ink-wash)[\w/-]*/, 'legacy Sumi-e utility should use --hv semantic tokens'],
  [/\b(?:text|bg|border)-accent-vermillion[\w/-]*/, 'vermillion utility should use --hv-accent-danger tokens'],
  [/\b(?:text|bg|border|ring|focus:border)-emerald[\w/-]*/, 'emerald utility should use --hv-accent-success tokens'],
  [/\bfont-(?:semibold|bold)\b/, 'bold font utility violates the Sumi-e readable-weight contract'],
  [/\bprose-invert\b/, 'prose-invert bypasses Sumi-e markdown colors'],
  [/\bprose\s+prose-/, 'Tailwind prose should be replaced by hervald-prose'],
  [/rgba\(/, 'raw rgba color should be a design-system token'],
  [/#[0-9A-Fa-f]{3,8}\b/, 'raw hex color should be a design-system token'],
  [/\]\/[0-9]/, 'arbitrary opacity cannot be appended to CSS variable utilities'],
  [/\]-hover\b/, 'malformed semantic token class'],
]

function collectAuditedFiles(path: string): string[] {
  const stat = statSync(path)
  if (stat.isFile()) {
    return /\.(css|tsx)$/.test(path) ? [path] : []
  }
  return readdirSync(path)
    .filter((entry) => entry !== '__tests__')
    .flatMap((entry) => collectAuditedFiles(join(path, entry)))
}

function getBlock(selector: string): string {
  const marker = `${selector} {`
  const startIndex = css.indexOf(marker)
  if (startIndex === -1) {
    throw new Error(`Missing CSS block for ${selector}`)
  }
  const bodyStart = startIndex + marker.length
  const bodyEnd = css.indexOf('\n  }', bodyStart)
  if (bodyEnd === -1) {
    throw new Error(`Unterminated CSS block for ${selector}`)
  }
  return css.slice(bodyStart, bodyEnd)
}

describe('theme surface CSS contracts', () => {
  it('binds mobile sheets to the active Herd background tokens', () => {
    const sheetBlock = getBlock('.sheet')

    expect(sheetBlock).toContain('background: var(--hv-bg);')
    expect(sheetBlock).toContain('color: var(--hv-fg);')
    expect(sheetBlock).toContain('border-top: 1px solid var(--hv-border-hair);')
    expect(sheetBlock).not.toContain('background: var(--washi-white')
  })

  it('binds mobile sheet handles to the active Herd foreground tokens', () => {
    const handleBlock = getBlock('.sheet-handle-bar')

    expect(handleBlock).toContain('background: var(--hv-fg-faint);')
    expect(handleBlock).not.toContain('background: #C4C4C4;')
  })

  it('keeps audited UI surfaces on Sumi-e semantic tokens', () => {
    const violations: string[] = []

    for (const file of auditedPaths.flatMap(collectAuditedFiles)) {
      const content = readFileSync(file, 'utf8')
      const relativePath = file.replace(`${appDir}/`, '')
      for (const [pattern, message] of forbiddenSurfacePatterns) {
        if (pattern.test(content)) {
          violations.push(`${relativePath}: ${message}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
