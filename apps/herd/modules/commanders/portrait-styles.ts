export const DEFAULT_COMMANDER_PORTRAIT_STYLE_ID = 'sumi-e' as const

export const COMMANDER_PORTRAIT_STYLES = [
  {
    id: DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
    label: 'Sumi-e',
    summary: 'Ink wash portrait with calm authority and uncluttered negative space.',
    promptPrefix: [
      'Style: sumi-e ink wash painting, monochrome black ink on washi paper, traditional Japanese minimalism, expressive single-stroke linework, subtle gradient washes, no color, square aspect ratio 1024x1024, portrait composition, no text or signature in image.',
      'Subject direction: one central figure only, chest-up portrait, calm authority, distinctive facial structure, strong silhouette, understated clothing, hands out of frame, uncluttered negative space.',
    ].join('\n\n'),
  },
  {
    id: 'chibi-sticker',
    label: 'Chibi sticker',
    summary: 'Cute illustrated sticker-pack style on a clean white background.',
    promptPrefix: [
      'Create a cute illustrated chibi sticker-pack style commander headshot. Clean white background, vertical output, thick white sticker border, playful rounded shapes, bright friendly expression, and crisp printable edges.',
      'Expression direction: choose one cute expressive mood for this commander, such as laughing, crying, sleepy, surprised, confused, eating, grumpy, reminding, approving, or saying good night. If text appears, keep it short and cute, for example: Good morning!, Whattt?, Huh?, I am reminding you!, So sleepy, Wow!, Approved!, Nice!, Hey you!, Achoo!, Angry!, Huh???, Good night :3, Too cuteee, or Am I cool yet?!',
    ].join('\n\n'),
  },
  {
    id: 'designer-toy-3d',
    label: 'Glossy 3D toy',
    summary: 'Premium glossy vinyl designer-toy render with studio lighting.',
    promptPrefix: [
      'Create a premium glossy 3D designer toy render of the commander. Render one floating head only, cropped cleanly below the jaw with a visible neck and the full head comfortably framed.',
      'Style: high-quality vinyl figure with ultra-smooth simplified forms, rounded volumes, strong glossy reflections across key facial areas, sculpted glossy stylized hair, and embedded playful accessories. Include oversized retro wraparound sunglasses with vibrant matching frame and lens colors. Use strong studio lighting with pronounced highlights. Background: blue sky with soft clouds.',
    ].join('\n\n'),
  },
] as const

export type CommanderPortraitStyleId = typeof COMMANDER_PORTRAIT_STYLES[number]['id']

const STYLE_IDS = new Set<string>(COMMANDER_PORTRAIT_STYLES.map((style) => style.id))

export const COMMANDER_PORTRAIT_STYLE_OPTIONS = COMMANDER_PORTRAIT_STYLES.map((style) => ({
  value: style.id,
  label: style.label,
}))

export function parseCommanderPortraitStyleId(raw: unknown): CommanderPortraitStyleId | null {
  if (typeof raw !== 'string') {
    return null
  }
  const normalized = raw.trim()
  return STYLE_IDS.has(normalized)
    ? normalized as CommanderPortraitStyleId
    : null
}

export function getCommanderPortraitStyle(
  styleId: CommanderPortraitStyleId | null | undefined,
) {
  return COMMANDER_PORTRAIT_STYLES.find((style) => style.id === styleId)
    ?? COMMANDER_PORTRAIT_STYLES[0]
}

export function listCommanderPortraitStyleIds(): string {
  return COMMANDER_PORTRAIT_STYLES.map((style) => style.id).join(', ')
}
