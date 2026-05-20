import {
  DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
  getCommanderPortraitStyle,
  type CommanderPortraitStyleId,
} from '../../modules/commanders/portrait-styles.js'

const EXCERPT_LIMIT = 2_000

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractNamedSections(markdown: string, sectionNames: ReadonlySet<string>): string[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const sections: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index]?.match(/^(#{1,6})\s+(.*)$/)
    if (!headingMatch) {
      continue
    }

    const headingLevel = headingMatch[1].length
    const headingText = headingMatch[2].trim()
    if (!sectionNames.has(headingText.toLowerCase())) {
      continue
    }

    const collected: string[] = [lines[index] ?? '']
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeadingMatch = lines[cursor]?.match(/^(#{1,6})\s+(.*)$/)
      if (nextHeadingMatch && nextHeadingMatch[1].length <= headingLevel) {
        break
      }
      collected.push(lines[cursor] ?? '')
    }

    const normalized = normalizeWhitespace(collected.join('\n'))
    if (normalized) {
      sections.push(normalized)
    }
  }

  return sections
}

export function extractCommanderMdExcerpt(commanderMd: string): string {
  const normalized = normalizeWhitespace(commanderMd)
  if (!normalized) {
    return ''
  }

  const sections = extractNamedSections(normalized, new Set(['identity', 'mission']))
  const source = sections.length > 0 ? sections.join('\n\n') : normalized
  return source.slice(0, EXCERPT_LIMIT).trim()
}

export function buildCommanderPortraitPrompt(input: {
  displayName: string
  commanderMdExcerpt: string
  styleId?: CommanderPortraitStyleId | null
}): string {
  const displayName = normalizeWhitespace(input.displayName)
  const commanderMdExcerpt = normalizeWhitespace(input.commanderMdExcerpt)
  const style = getCommanderPortraitStyle(input.styleId ?? DEFAULT_COMMANDER_PORTRAIT_STYLE_ID)

  return [
    `Create a portrait of ${displayName}, a Hervald commander.`,
    `Portrait style (${style.label}):`,
    style.promptPrefix,
    'Identity cues from COMMANDER.md:',
    commanderMdExcerpt || 'No additional COMMANDER.md excerpt was available.',
    'Render the commander as one central portrait informed by the identity cues above. Avoid fantasy armor, modern UI overlays, symbols, captions, logos, background clutter, and duplicate heads.',
  ].join('\n\n')
}

export function buildSumiPortraitPrompt(input: {
  displayName: string
  commanderMdExcerpt: string
}): string {
  return buildCommanderPortraitPrompt({
    ...input,
    styleId: DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
  })
}
