export interface CommandRoomRouteMetadata {
  launch: {
    routeId: string
    path: string
    commanderParam: string
    conversationParam: string
  }
  globalCommander: {
    commanderValue: string
    panelParam: string
    defaultPanel: string
  }
  mobile: {
    surfaceParam: string
    modes: readonly {
      id: 'sessions' | 'inbox' | 'settings'
      path: string
    }[]
    normalizeGlobalRoute: boolean
  }
}

export interface CommandRoomLaunchTarget {
  routeId: CommandRoomRouteMetadata['launch']['routeId']
  path: string
  commanderId: string
  conversationId: string | null
  panel: string | null
}

export const COMMAND_ROOM_ROUTE_METADATA = {
  launch: {
    routeId: 'command-room.ui',
    path: '/command-room',
    commanderParam: 'commander',
    conversationParam: 'conversation',
  },
  globalCommander: {
    commanderValue: 'global',
    panelParam: 'panel',
    defaultPanel: 'automation',
  },
  mobile: {
    surfaceParam: 'surface',
    modes: [
      { id: 'sessions', path: '/command-room' },
      { id: 'inbox', path: '/command-room/inbox' },
      { id: 'settings', path: '/command-room/settings' },
    ],
    normalizeGlobalRoute: true,
  },
} as const satisfies CommandRoomRouteMetadata

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMobileMode(value: unknown): value is CommandRoomRouteMetadata['mobile']['modes'][number] {
  if (!isObject(value)) {
    return false
  }

  return (
    (value.id === 'sessions' || value.id === 'inbox' || value.id === 'settings')
    && isNonEmptyString(value.path)
  )
}

export function normalizeCommandRoomRouteMetadata(
  metadata: unknown,
): CommandRoomRouteMetadata {
  if (
    !isObject(metadata)
    || !isObject(metadata.launch)
    || !isObject(metadata.globalCommander)
    || !isObject(metadata.mobile)
  ) {
    return COMMAND_ROOM_ROUTE_METADATA
  }

  if (
    !isNonEmptyString(metadata.launch.routeId)
    || !isNonEmptyString(metadata.launch.path)
    || !isNonEmptyString(metadata.launch.commanderParam)
    || !isNonEmptyString(metadata.launch.conversationParam)
    || !isNonEmptyString(metadata.globalCommander.commanderValue)
    || !isNonEmptyString(metadata.globalCommander.panelParam)
    || !isNonEmptyString(metadata.globalCommander.defaultPanel)
    || !isNonEmptyString(metadata.mobile.surfaceParam)
    || typeof metadata.mobile.normalizeGlobalRoute !== 'boolean'
    || !Array.isArray(metadata.mobile.modes)
    || metadata.mobile.modes.length === 0
    || !metadata.mobile.modes.every(isMobileMode)
  ) {
    return COMMAND_ROOM_ROUTE_METADATA
  }

  const modes = metadata.mobile.modes as CommandRoomRouteMetadata['mobile']['modes']
  if (
    !modes.some((mode) => mode.id === 'sessions')
    || !modes.some((mode) => mode.id === 'inbox')
    || !modes.some((mode) => mode.id === 'settings')
  ) {
    return COMMAND_ROOM_ROUTE_METADATA
  }

  return {
    launch: {
      routeId: metadata.launch.routeId,
      path: metadata.launch.path,
      commanderParam: metadata.launch.commanderParam,
      conversationParam: metadata.launch.conversationParam,
    },
    globalCommander: {
      commanderValue: metadata.globalCommander.commanderValue,
      panelParam: metadata.globalCommander.panelParam,
      defaultPanel: metadata.globalCommander.defaultPanel,
    },
    mobile: {
      surfaceParam: metadata.mobile.surfaceParam,
      modes,
      normalizeGlobalRoute: metadata.mobile.normalizeGlobalRoute,
    },
  }
}

export function buildCommandRoomLaunchTarget(
  input: {
    commanderId: string
    conversationId?: string | null
    panel?: string | null
  },
  metadata: CommandRoomRouteMetadata = COMMAND_ROOM_ROUTE_METADATA,
): CommandRoomLaunchTarget {
  const commanderId = input.commanderId.trim()
  const conversationId = input.conversationId?.trim() || null
  const panel = input.panel?.trim() || null
  const params = new URLSearchParams({
    [metadata.launch.commanderParam]: commanderId,
  })
  if (conversationId) {
    params.set(metadata.launch.conversationParam, conversationId)
  }
  if (panel) {
    params.set(metadata.globalCommander.panelParam, panel)
  }

  return {
    routeId: metadata.launch.routeId,
    path: `${metadata.launch.path}?${params.toString()}`,
    commanderId,
    conversationId,
    panel,
  }
}

export function normalizeCommandRoomGlobalSearchParams(
  source: URLSearchParams,
  metadata: CommandRoomRouteMetadata = COMMAND_ROOM_ROUTE_METADATA,
): URLSearchParams {
  const nextParams = new URLSearchParams(source)
  nextParams.set(metadata.launch.commanderParam, metadata.globalCommander.commanderValue)
  nextParams.set(metadata.globalCommander.panelParam, metadata.globalCommander.defaultPanel)
  nextParams.delete(metadata.launch.conversationParam)
  return nextParams
}
