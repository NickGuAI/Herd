import { describe, expect, it, vi } from 'vitest'
import { fetchJson } from '@/lib/api'
import { fetchSkills } from '../use-skills'

vi.mock('@/lib/api', () => ({
  fetchJson: vi.fn(),
}))

describe('fetchSkills', () => {
  it('loads user-invocable conversation skills from the canonical skills API', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce([
      {
        name: 'wide-research',
        dirName: 'wide-research',
        description: 'Parallel research',
        userInvocable: true,
        argumentHint: '<topic>',
        supportedProviders: ['codex', 'claude code'],
        source: 'direct-skills',
      },
      {
        name: 'notion',
        dirName: 'notion',
        description: 'Internal helper',
        userInvocable: false,
      },
    ])

    await expect(fetchSkills()).resolves.toEqual([
      {
        name: 'wide-research',
        dirName: 'wide-research',
        description: 'Parallel research',
        userInvocable: true,
        argumentHint: '<topic>',
        supportedProviders: ['codex', 'claude code'],
        source: 'direct-skills',
      },
    ])
    expect(fetchJson).toHaveBeenCalledWith('/api/skills')
  })

  it('accepts wrapped skill payloads and falls back to dirName for display name', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      skills: [
        {
          name: '',
          dirName: 'read_pdf',
          description: '',
          userInvocable: true,
          supportedProviders: '',
          source: '  bundled-skills  ',
        },
      ],
    })

    await expect(fetchSkills()).resolves.toEqual([
      {
        name: 'read_pdf',
        dirName: 'read_pdf',
        description: '',
        userInvocable: true,
        argumentHint: undefined,
        supportedProviders: undefined,
        source: 'bundled-skills',
      },
    ])
  })

  it('propagates API/auth failures instead of converting them to an empty skills list', async () => {
    const error = new Error('Unauthorized')
    vi.mocked(fetchJson).mockRejectedValueOnce(error)

    await expect(fetchSkills()).rejects.toThrow('Unauthorized')
  })
})
