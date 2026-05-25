import { describe, expect, it } from 'vitest'
import { formatQueuePreview } from '../queue-state'

describe('formatQueuePreview', () => {
  it('prefers display text over provider-bound workspace context text', () => {
    const preview = formatQueuePreview({
      text: '<workspace-files>\n@README.md\n</workspace-files>\nUse this context.',
      displayText: 'Use this context.',
    })

    expect(preview).toBe('Use this context.')
    expect(preview).not.toContain('<workspace-')
  })
})
