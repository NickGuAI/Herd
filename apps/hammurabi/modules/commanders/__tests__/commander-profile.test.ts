import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMANDER_AVATAR_URL,
  profileForApiResponse,
  sanitizeUiProfile,
} from '../commander-profile.js'
import { ensureCommanderVisualProfile } from '../commander-visual-profile.js'
import { DEFAULT_COMMANDER_PORTRAIT_STYLE_ID } from '../portrait-styles.js'

describe('sanitizeUiProfile', () => {
  it('accepts current profile fields and drops legacy color identity', () => {
    expect(
      sanitizeUiProfile({
        borderColor: '#1a1a1a',
        accentColor: 'rgb(10, 20, 30)',
        speakingTone: 'Dry wit, concise.',
        avatar: '.memory/avatar.png',
        portraitStyleId: 'designer-toy-3d',
      }),
    ).toEqual({
      speakingTone: 'Dry wit, concise.',
      avatar: '.memory/avatar.png',
      portraitStyleId: 'designer-toy-3d',
    })
  })

  it('returns null when a legacy profile only carries identity colors', () => {
    expect(
      sanitizeUiProfile({
        borderColor: 'var(--hv-accent-plum)',
        accentColor: 'var(--hv-accent-pine)',
      }),
    ).toBeNull()
  })

  it('rejects path traversal in avatar', () => {
    expect(
      sanitizeUiProfile({
        avatar: '../../../etc/passwd',
      }),
    ).toEqual(null)
  })

  it('returns null for legacy-only invalid color fields', () => {
    expect(
      sanitizeUiProfile({
        borderColor: 'url(javascript:alert(1))',
      }),
    ).toEqual(null)
  })
})

describe('ensureCommanderVisualProfile', () => {
  it('does not synthesize color identity for missing profiles', () => {
    expect(ensureCommanderVisualProfile('commander-a', null)).toEqual({})
  })

  it('drops explicit legacy colors while preserving current fields', () => {
    expect(
      ensureCommanderVisualProfile('commander-a', {
        borderColor: 'var(--hv-accent-plum)',
        speakingTone: 'Dry wit, concise.',
      }),
    ).toEqual({
      speakingTone: 'Dry wit, concise.',
    })
  })

  it('normalizes API profile responses without legacy color identity', () => {
    expect(
      profileForApiResponse('commander-a', {
        speakingTone: 'Dry wit, concise.',
      }),
    ).toEqual({
      portraitStyleId: DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
      speakingTone: 'Dry wit, concise.',
    })
  })

  it('keeps the bundled default avatar URL stable for fresh installs', () => {
    expect(DEFAULT_COMMANDER_AVATAR_URL).toBe('/assets/commanders/atlas-profile.jpg')
  })
})
