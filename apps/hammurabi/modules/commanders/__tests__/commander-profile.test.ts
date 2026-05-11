import { describe, expect, it } from 'vitest'
import { profileForApiResponse, sanitizeUiProfile } from '../commander-profile.js'
import {
  defaultCommanderVisualProfile,
  ensureCommanderVisualProfile,
} from '../commander-visual-profile.js'

describe('sanitizeUiProfile', () => {
  it('accepts valid profile fields', () => {
    expect(
      sanitizeUiProfile({
        borderColor: '#1a1a1a',
        accentColor: 'rgb(10, 20, 30)',
        speakingTone: 'Dry wit, concise.',
        avatar: '.memory/avatar.png',
      }),
    ).toEqual({
      borderColor: '#1a1a1a',
      accentColor: 'rgb(10, 20, 30)',
      speakingTone: 'Dry wit, concise.',
      avatar: '.memory/avatar.png',
    })
  })

  it('accepts semantic Hervald color tokens', () => {
    expect(
      sanitizeUiProfile({
        borderColor: 'var(--hv-accent-plum)',
        accentColor: 'var(--hv-accent-pine)',
      }),
    ).toEqual({
      borderColor: 'var(--hv-accent-plum)',
      accentColor: 'var(--hv-accent-pine)',
    })
  })

  it('rejects path traversal in avatar', () => {
    expect(
      sanitizeUiProfile({
        avatar: '../../../etc/passwd',
      }),
    ).toEqual(null)
  })

  it('rejects absurd border colors', () => {
    expect(
      sanitizeUiProfile({
        borderColor: 'url(javascript:alert(1))',
      }),
    ).toEqual(null)
  })
})

describe('ensureCommanderVisualProfile', () => {
  it('fills missing border and accent colors from stable commander identity', () => {
    expect(ensureCommanderVisualProfile('commander-a', null)).toEqual(
      defaultCommanderVisualProfile('commander-a'),
    )
  })

  it('preserves explicit colors while filling only missing fields', () => {
    expect(
      ensureCommanderVisualProfile('commander-a', {
        borderColor: 'var(--hv-accent-plum)',
        speakingTone: 'Dry wit, concise.',
      }),
    ).toEqual({
      borderColor: 'var(--hv-accent-plum)',
      accentColor: defaultCommanderVisualProfile('commander-a').accentColor,
      speakingTone: 'Dry wit, concise.',
    })
  })

  it('normalizes API profile responses so commander UI identity is never colorless', () => {
    expect(
      profileForApiResponse('commander-a', {
        speakingTone: 'Dry wit, concise.',
      }),
    ).toEqual({
      ...defaultCommanderVisualProfile('commander-a'),
      speakingTone: 'Dry wit, concise.',
    })
  })
})
