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

  const handleClick = async () => {
    try {
      const response = await fetchJson<OrgCheckOnTargetResponse>(
        `/api/org/commanders/${encodeURIComponent(commander.id)}/check-on-target`,
      )
      navigate(response.target.path)
      return
    } catch {
      const fallback = buildCommandRoomLaunchTarget({ commanderId: commander.id }, routeMetadata)
      navigate(fallback.path)
    }
  }

  return (
    <button
      type="button"
      data-testid="commander-check-on-hero"
      data-commander-id={commander.id}
      onClick={() => {
        void handleClick()
      }}
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
