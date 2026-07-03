import { useMemo } from 'react'
import { MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  buildCommandRoomLaunchTarget,
  normalizeCommandRoomRouteMetadata,
} from '@modules/command-room/route-metadata'
import { fetchJson } from '@/lib/api'
import { findModuleGraphUiRouteMetadata } from '@/module-graph-bindings'
import { useModuleGraphContext } from '@/module-graph-context'
import type { OrgCheckOnTargetResponse } from '../types'
import type { OrgNode } from '../types'

function isStillViewingCommanderLaunch(
  commanderId: string,
  routePath: string,
  commanderParam: string,
  conversationParam: string,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const params = new URLSearchParams(window.location.search)
  return (
    window.location.pathname === routePath
    && params.get(commanderParam) === commanderId
    && !params.has(conversationParam)
  )
}

export function CheckOnHero({
  commander,
}: {
  commander: OrgNode
}) {
  const navigate = useNavigate()
  const moduleGraph = useModuleGraphContext()
  const routeMetadata = useMemo(
    () => normalizeCommandRoomRouteMetadata(
      findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui'),
    ),
    [moduleGraph],
  )

  const handleClick = () => {
    const fallback = buildCommandRoomLaunchTarget({ commanderId: commander.id }, routeMetadata)
    navigate(fallback.path)

    void fetchJson<OrgCheckOnTargetResponse>(
      `/api/org/commanders/${encodeURIComponent(commander.id)}/check-on-target`,
    ).then((response) => {
      if (
        response.target.conversationId
        && response.target.commanderId === commander.id
        && isStillViewingCommanderLaunch(
          commander.id,
          routeMetadata.launch.path,
          routeMetadata.launch.commanderParam,
          routeMetadata.launch.conversationParam,
        )
      ) {
        const target = buildCommandRoomLaunchTarget({
          commanderId: commander.id,
          conversationId: response.target.conversationId,
        }, routeMetadata)
        navigate(target.path, { replace: true })
      }
    }).catch(() => {
      // Initial navigation already landed on the commander; lookup failure is non-blocking.
    })
  }

  return (
    <button
      type="button"
      data-testid="commander-check-on-hero"
      data-commander-id={commander.id}
      onClick={handleClick}
      className="card-sumi flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-[var(--hv-surface-hover)]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hv-surface-selected)] text-[color:var(--hv-fg)]">
          <MessageSquare size={16} aria-hidden="true" />
        </span>
        <span className="truncate text-lg font-medium text-[color:var(--hv-fg)]">
          Check On {commander.displayName}
        </span>
      </span>
    </button>
  )
}
