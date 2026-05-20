import { describe, expect, it } from 'vitest'
import {
  buildCommandRoomGlobalPath,
  buildCommandRoomLaunchTarget,
  COMMAND_ROOM_ROUTE_METADATA,
  normalizeCommandRoomGlobalSearchParams,
  normalizeCommandRoomRouteMetadata,
} from '../route-metadata'

describe('command-room route metadata contracts', () => {
  it('builds canonical commander launch targets with optional conversation selection', () => {
    expect(buildCommandRoomLaunchTarget({
      commanderId: 'cmd-1',
      conversationId: 'conv-9',
    })).toEqual({
      routeId: 'command-room.ui',
      path: '/command-room?commander=cmd-1&conversation=conv-9',
      commanderId: 'cmd-1',
      conversationId: 'conv-9',
    })

    expect(buildCommandRoomLaunchTarget({ commanderId: 'cmd-1' })).toMatchObject({
      path: '/command-room?commander=cmd-1',
      conversationId: null,
    })
  })

  it('normalizes global commander routes to the automation panel while preserving surface mode', () => {
    const params = normalizeCommandRoomGlobalSearchParams(
      new URLSearchParams('surface=mobile&conversation=old'),
    )

    expect(params.toString()).toBe('surface=mobile&commander=global&panel=automation')
    expect(buildCommandRoomGlobalPath(new URLSearchParams('surface=mobile'))).toBe(
      '/command-room?surface=mobile&commander=global&panel=automation',
    )
  })

  it('falls back to the current metadata contract when unknown metadata is received', () => {
    expect(normalizeCommandRoomRouteMetadata({ launch: { path: '/other' } })).toMatchObject({
      launch: {
        routeId: 'command-room.ui',
        path: '/command-room',
      },
      globalCommander: {
        commanderValue: 'global',
        defaultPanel: 'automation',
      },
    })
  })

  it('honors valid backend-provided route metadata instead of forcing local defaults', () => {
    const metadata = normalizeCommandRoomRouteMetadata({
      ...COMMAND_ROOM_ROUTE_METADATA,
      launch: {
        routeId: 'command-room.ui',
        path: '/room',
        commanderParam: 'c',
        conversationParam: 'thread',
      },
      globalCommander: {
        commanderValue: 'all',
        panelParam: 'tab',
        defaultPanel: 'automation',
      },
      mobile: {
        ...COMMAND_ROOM_ROUTE_METADATA.mobile,
        surfaceParam: 'mode',
      },
    })

    expect(buildCommandRoomLaunchTarget({
      commanderId: 'cmd-1',
      conversationId: 'conv-9',
    }, metadata).path).toBe('/room?c=cmd-1&thread=conv-9')
    expect(buildCommandRoomGlobalPath(new URLSearchParams('mode=mobile'), metadata)).toBe(
      '/room?mode=mobile&c=all&tab=automation',
    )
  })
})
