import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { findModuleGraphUiRouteMetadata } from '@/module-graph-bindings'
import { useModuleGraphContext } from '@/module-graph-context'
import type { FrontendNavItem } from '@/types'
import { normalizeCommandRoomRouteMetadata } from '@modules/command-room/route-metadata'
import { isImmersiveMobileChatRoute } from './mobile-shell-routes'

interface MobileBottomTabsProps {
  modules: FrontendNavItem[]
  pendingCount: number
}

/**
 * Canonical Herd mobile bottom tab bar.
 *
 * Mounted by `src/surfaces/mobile/MobileShell.tsx` on any Herd mobile route
 * and hydrated from backend module graph nav metadata. Self-hides on the
 * immersive chat route `/command-room?commander=<id>`.
 */
export function MobileBottomTabs({ modules, pendingCount }: MobileBottomTabsProps) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const moduleGraph = useModuleGraphContext()
  const routeMetadata = useMemo(
    () => normalizeCommandRoomRouteMetadata(
      findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui'),
    ),
    [moduleGraph],
  )
  const inChat = isImmersiveMobileChatRoute(location.pathname, searchParams, routeMetadata)
  const surfaceParam = routeMetadata.mobile.surfaceParam
  const surfaceSearch = searchParams.get(surfaceParam)

  const mobileModules = useMemo(
    () => modules
      .filter((module) => (
        !module.hideFromNav
        && (module.navGroup ?? 'primary') === 'primary'
        && module.surfaces.includes('mobile')
      ))
      .map((module) => ({
        ...module,
        path: withSurfaceQuery(module.path, surfaceParam, surfaceSearch),
        badge: module.routeId === 'approvals.mobile-inbox-ui' ? pendingCount : module.badge,
      })),
    [modules, pendingCount, surfaceParam, surfaceSearch],
  )

  // Immersive chat view hides the tab bar per the canonical mock.
  if (inChat) {
    return null
  }

  return (
    <div data-testid="hervald-mobile-tabs">
      <BottomNav modules={mobileModules} forceVisible />
    </div>
  )
}

function withSurfaceQuery(path: string, surfaceParam: string, surface: string | null): string {
  if (!surface) {
    return path
  }
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${encodeURIComponent(surfaceParam)}=${encodeURIComponent(surface)}`
}
