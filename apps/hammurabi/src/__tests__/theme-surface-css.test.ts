import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

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
  it('binds mobile sheets to the active Hervald background tokens', () => {
    const sheetBlock = getBlock('.sheet')

    expect(sheetBlock).toContain('background: var(--hv-bg, #FAF8F5);')
    expect(sheetBlock).toContain('color: var(--hv-fg, #1C1C1C);')
    expect(sheetBlock).toContain('border-top: 1px solid var(--hv-border-hair, rgba(28, 28, 28, 0.06));')
    expect(sheetBlock).not.toContain('background: var(--washi-white')
  })

  it('binds mobile sheet handles to the active Hervald foreground tokens', () => {
    const handleBlock = getBlock('.sheet-handle-bar')

    expect(handleBlock).toContain('background: var(--hv-fg-faint, #A8A19A);')
    expect(handleBlock).not.toContain('background: #C4C4C4;')
  })
})
