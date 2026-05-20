import { describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '../../types'
import { buildCommanderProfileCardItems } from '../CommanderProfileCardGrid'

function createCommander(overrides: Partial<OrgNode> = {}): OrgNode {
  return {
    id: 'cmd-1',
    kind: 'commander',
    parentId: 'founder-1',
    displayName: 'Atlas Prime',
    avatarUrl: null,
    profile: {
      speakingTone: 'Strategic',
      portraitStyleId: 'sumi-e-ink',
    },
    status: 'active',
    costUsd: 0,
    archived: false,
    ...overrides,
  }
}

describe('buildCommanderProfileCardItems', () => {
  it('maps org nodes into ProfileCard items without identity colors', () => {
    const onSelect = vi.fn()
    const [item] = buildCommanderProfileCardItems({
      commanders: [createCommander()],
      expandedId: 'cmd-1',
      onSelect,
    })

    expect(item).toMatchObject({
      id: 'cmd-1',
      avatarUrl: null,
      name: 'Atlas Prime',
      title: 'Commander',
      handle: '@atlas-prime',
      status: 'Running',
      statusState: 'active',
      selected: true,
      archived: false,
    })
    expect(item).not.toHaveProperty('borderColor')
    expect(item).not.toHaveProperty('accentColor')
    expect(item).not.toHaveProperty('gradient')

    item.onClick()
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('preserves archived structure and selects a new commander when collapsed', () => {
    const onSelect = vi.fn()
    const [item] = buildCommanderProfileCardItems({
      commanders: [createCommander({
        id: 'cmd-2',
        displayName: 'Borealis',
        profile: null,
        archived: true,
        status: 'paused',
      })],
      expandedId: null,
      onSelect,
    })

    expect(item).toMatchObject({
      id: 'cmd-2',
      name: 'Borealis',
      title: 'Commander',
      handle: '@borealis',
      status: 'Archived',
      statusState: 'idle',
      selected: false,
      archived: true,
    })

    item.onClick()
    expect(onSelect).toHaveBeenCalledWith('cmd-2')
  })
})
