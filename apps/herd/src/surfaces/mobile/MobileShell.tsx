import { useLocation, useSearchParams } from 'react-router-dom'
import type { FrontendNavItem } from '@/types'
import { findModuleGraphUiRouteMetadata } from '@/module-graph-bindings'
import { useModuleGraphContext } from '@/module-graph-context'
import { normalizeCommandRoomRouteMetadata } from '@modules/command-room/route-metadata'
import {
  isImmersiveMobileChatRoute,
  MOBILE_CHAT_FLOATING_BOTTOM_OFFSET_CLASS,
  MOBILE_SHELL_BOTTOM_PADDING_CLASS,
  MOBILE_SHELL_FLOATING_BOTTOM_OFFSET_CLASS,
} from './mobile-shell-routes'
import { MobileNavigationDrawer } from './MobileNavigationDrawer'

interface MobileShellChromeState {
  shouldRenderMobileChrome: boolean
  mainPaddingClassName: string
  floatingBottomOffsetClassName: string
}

interface UseMobileShellChromeStateArgs {
  isMobile: boolean
}

interface MobileShellChromeProps {
  modules: FrontendNavItem[]
  pendingCount: number
}

export function useMobileShellChromeState({
  isMobile,
}: UseMobileShellChromeStateArgs): MobileShellChromeState {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const moduleGraph = useModuleGraphContext()
  const routeMetadata = normalizeCommandRoomRouteMetadata(
    findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui'),
  )
  const inImmersiveChat = isImmersiveMobileChatRoute(
    location.pathname,
    searchParams,
    routeMetadata,
  )

  const shouldRenderMobileChrome = isMobile && !inImmersiveChat

  return {
    shouldRenderMobileChrome,
    mainPaddingClassName: shouldRenderMobileChrome ? MOBILE_SHELL_BOTTOM_PADDING_CLASS : '',
    floatingBottomOffsetClassName: isMobile && inImmersiveChat
      ? MOBILE_CHAT_FLOATING_BOTTOM_OFFSET_CLASS
      : MOBILE_SHELL_FLOATING_BOTTOM_OFFSET_CLASS,
  }
}

export function MobileShellChrome({ modules, pendingCount }: MobileShellChromeProps) {
  return <MobileNavigationDrawer modules={modules} pendingCount={pendingCount} />
}
