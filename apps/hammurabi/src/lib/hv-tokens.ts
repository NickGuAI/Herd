import { useEffect, useMemo, useState } from 'react'

export function readHvToken(name: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function readHvTokens(names: readonly string[]): Record<string, string> {
  return names.reduce<Record<string, string>>((tokens, name) => {
    tokens[name] = readHvToken(name)
    return tokens
  }, {})
}

export function useHvTokens(names: readonly string[]): Record<string, string> {
  const namesKey = names.join('\n')
  const stableNames = useMemo(() => names, [namesKey])
  const [tokens, setTokens] = useState(() => readHvTokens(stableNames))

  useEffect(() => {
    const refresh = () => setTokens(readHvTokens(stableNames))

    refresh()

    if (typeof MutationObserver === 'undefined') {
      return undefined
    }

    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [stableNames])

  return tokens
}

export function readHvTerminalTheme(): { background: string; foreground: string } {
  return {
    background: readHvToken('--hv-bg') || 'Canvas',
    foreground: readHvToken('--hv-fg') || 'CanvasText',
  }
}

export function readHvTerminalFontFamily(): string {
  return readHvToken('--hv-font-mono') || 'monospace'
}
