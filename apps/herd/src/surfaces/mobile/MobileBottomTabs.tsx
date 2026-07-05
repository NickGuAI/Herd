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

function compareMobileTabOrder(left: FrontendNavItem, right: FrontendNavItem): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
}

function toMobileTabModule(module: FrontendNavItem): FrontendNavItem {
  if (module.routeId !== 'command-room.ui') {
    return module
  }

  return {
    ...module,
    label: 'Sessions',
    surfaces: module.surfaces.includes('mobile')
      ? module.surfaces
      : [...module.surfaces, 'mobile'],
    order: 15,
  }
}

/**
 * Pure tab-set selection for the mobile bar: Command Room remap, mobile-primary
 * filter, canonical order. Exported so the IA can be pinned against the real
 * module manifest in tests.
 */
export function selectMobileTabModules(modules: FrontendNavItem[]): FrontendNavItem[] {
  return modules
    .map(toMobileTabModule)
    .filter((module) => (
      !module.hideFromNav
      && (module.navGroup ?? 'primary') === 'primary'
      && module.surfaces.includes('mobile')
    ))
    .sort(compareMobileTabOrder)
}

/**
 * Canonical Herd mobile bottom tab bar.
 *
 * Mounted by `src/surfaces/mobile/MobileShell.tsx` on any Herd mobile route
 * and hydrated from backend module graph nav metadata. Self-hides on the
 * immersive chat route for a selected commander.
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
    () => selectMobileTabModules(modules)
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
