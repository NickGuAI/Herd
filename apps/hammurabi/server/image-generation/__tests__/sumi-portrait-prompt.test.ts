import { describe, expect, it } from 'vitest'
import {
  buildCommanderPortraitPrompt,
  buildSumiPortraitPrompt,
  extractCommanderMdExcerpt,
} from '../sumi-portrait-prompt'

describe('sumi portrait prompt', () => {
  it('extracts Identity and Mission sections and builds a deterministic prompt', () => {
    const commanderMd = `
# Atlas

## Identity
Atlas is a rigorous engineering commander.
She prefers surgical edits, clear reasoning, and durable systems.

### Signals
- Focused
- Direct

## Core Lanes
Ignore this section for the excerpt.

## Mission
Own the feature work end-to-end.
Protect system integrity while moving quickly.

## Appendix
Out of scope.
`

    expect(extractCommanderMdExcerpt(commanderMd)).toMatchInlineSnapshot(`
      "## Identity
      Atlas is a rigorous engineering commander.
      She prefers surgical edits, clear reasoning, and durable systems.

      ### Signals
      - Focused
      - Direct

      ## Mission
      Own the feature work end-to-end.
      Protect system integrity while moving quickly."
    `)

    expect(buildSumiPortraitPrompt({
      displayName: 'Atlas',
      commanderMdExcerpt: extractCommanderMdExcerpt(commanderMd),
    })).toMatchInlineSnapshot(`
      "Create a portrait of Atlas, a Hervald commander.

      Portrait style (Sumi-e):

      Style: sumi-e ink wash painting, monochrome black ink on washi paper, traditional Japanese minimalism, expressive single-stroke linework, subtle gradient washes, no color, square aspect ratio 1024x1024, portrait composition, no text or signature in image.

      Subject direction: one central figure only, chest-up portrait, calm authority, distinctive facial structure, strong silhouette, understated clothing, hands out of frame, uncluttered negative space.

      Identity cues from COMMANDER.md:

      ## Identity
      Atlas is a rigorous engineering commander.
      She prefers surgical edits, clear reasoning, and durable systems.

      ### Signals
      - Focused
      - Direct

      ## Mission
      Own the feature work end-to-end.
      Protect system integrity while moving quickly.

      Render the commander as one central portrait informed by the identity cues above. Avoid fantasy armor, modern UI overlays, symbols, captions, logos, background clutter, and duplicate heads."
    `)
  })

  it('applies selected built-in portrait style prompt prefixes', () => {
    expect(buildCommanderPortraitPrompt({
      displayName: 'Gaia',
      commanderMdExcerpt: '## Identity\nGaia helps users onboard.',
      styleId: 'designer-toy-3d',
    })).toContain('Portrait style (Glossy 3D toy):')

    expect(buildCommanderPortraitPrompt({
      displayName: 'Gaia',
      commanderMdExcerpt: '## Identity\nGaia helps users onboard.',
      styleId: 'chibi-sticker',
    })).toContain('cute illustrated chibi sticker-pack style commander headshot')
  })
})
