import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import type { LucideProps } from 'lucide-react'
import {
  CalendarClock,
  Circle,
  ClipboardCheck,
  Menu,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { useAgentSessions } from '@/hooks/use-agents'
import { findModuleGraphUiRouteMetadata } from '@/module-graph-bindings'
import { useModuleGraphContext } from '@/module-graph-context'
import { cn } from '@/lib/utils'
import type { AgentSession, FrontendNavItem } from '@/types'
import {
  buildCommandRoomLaunchTarget,
  normalizeCommandRoomRouteMetadata,
  type CommandRoomRouteMetadata,
} from '@modules/command-room/route-metadata'

interface MobileNavigationDrawerProps {
  modules: FrontendNavItem[]
  pendingCount: number
}

interface DrawerDestination extends FrontendNavItem {
  badge?: number
}

interface RecentSession {
  id: string
  label: string
  href: string
  subtitle: string
}

type CommanderRecentSession = AgentSession & {
  creator: {
    kind: 'commander'
    id: string
  }
}

const iconMap: Record<string, ComponentType<LucideProps>> = {
  CalendarClock,
  ClipboardCheck,
  Settings,
  Users,
  Circle,
}

function compareDrawerOrder(left: FrontendNavItem, right: FrontendNavItem): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
}

export function selectMobileDrawerDestinations(modules: FrontendNavItem[]): FrontendNavItem[] {
  return modules
    .filter((module) => (
      !module.hideFromNav
      && (module.navGroup ?? 'primary') === 'primary'
      && module.surfaces.includes('mobile')
    ))
    .sort(compareDrawerOrder)
}

function normalizePath(path: string): string {
  const pathname = path.split('?')[0]?.replace(/\/+$/u, '') ?? ''
  return pathname || '/'
}

function isExactPathActive(pathname: string, to: string): boolean {
  return normalizePath(pathname) === normalizePath(to)
}

function isPathWithin(pathname: string, parentPath: string): boolean {
  const current = normalizePath(pathname)
  const parent = normalizePath(parentPath)
  return current === parent || current.startsWith(`${parent}/`)
}

function isDrawerDestinationActive(pathname: string, destination: DrawerDestination): boolean {
  if (destination.routeId === 'settings.mobile-ui') {
    return isPathWithin(pathname, destination.path)
  }
  return isExactPathActive(pathname, destination.path)
}

function withSurfaceQuery(path: string, surfaceParam: string, surface: string | null): string {
  if (!surface) {
    return path
  }
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${encodeURIComponent(surfaceParam)}=${encodeURIComponent(surface)}`
}

function getSessionLastActivity(session: AgentSession): string {
  const rawLastActivity = (session as AgentSession & { lastActivityAt?: unknown }).lastActivityAt
  return typeof rawLastActivity === 'string' && rawLastActivity.trim()
    ? rawLastActivity
    : session.created
}

function getSessionConversationId(session: AgentSession): string | null {
  const rawConversationId = session.conversationId
  return typeof rawConversationId === 'string' && rawConversationId.trim()
    ? rawConversationId.trim()
    : null
}

function isCommanderRecentSession(session: AgentSession): session is CommanderRecentSession {
  return (
    session.sessionType === 'commander'
    && session.creator?.kind === 'commander'
    && typeof session.creator.id === 'string'
    && session.creator.id.trim().length > 0
  )
}

function buildRecentSessionHref(
  session: CommanderRecentSession,
  routeMetadata: CommandRoomRouteMetadata,
  surfaceParam: string,
  surface: string | null,
): string {
  const path = buildCommandRoomLaunchTarget({
    commanderId: session.creator.id.trim(),
    conversationId: getSessionConversationId(session),
  }, routeMetadata).path
  return withSurfaceQuery(path, surfaceParam, surface)
}

function toRecentSessions(
  sessions: readonly AgentSession[],
  query: string,
  routeMetadata: CommandRoomRouteMetadata,
  surfaceParam: string,
  surface: string | null,
): RecentSession[] {
  const normalizedQuery = query.trim().toLowerCase()
  const sortedSessions = [...sessions]
    .filter(isCommanderRecentSession)
    .sort((left, right) => Date.parse(getSessionLastActivity(right)) - Date.parse(getSessionLastActivity(left)))
  const commanderIdsWithSpecificTargets = new Set(
    sortedSessions
      .filter((session) => getSessionConversationId(session) !== null)
      .map((session) => session.creator.id.trim()),
  )
  const seenFallbackCommanderIds = new Set<string>()
  const seenSpecificTargets = new Set<string>()
  return sortedSessions
    .filter((session) => {
      const commanderId = session.creator.id.trim()
      const conversationId = getSessionConversationId(session)
      if (conversationId) {
        const targetKey = `${commanderId}:${conversationId}`
        if (seenSpecificTargets.has(targetKey)) {
          return false
        }
        seenSpecificTargets.add(targetKey)
        return true
      }
      if (commanderIdsWithSpecificTargets.has(commanderId) || seenFallbackCommanderIds.has(commanderId)) {
        return false
      }
      seenFallbackCommanderIds.add(commanderId)
      return true
    })
    .map((session) => {
      const label = session.label?.trim() || session.name
      return {
        id: session.name,
        label,
        href: buildRecentSessionHref(session, routeMetadata, surfaceParam, surface),
        subtitle: session.agentType ?? session.sessionType ?? 'session',
      }
    })
    .filter((session) => (
      !normalizedQuery
      || session.label.toLowerCase().includes(normalizedQuery)
      || session.subtitle.toLowerCase().includes(normalizedQuery)
    ))
    .slice(0, 4)
}

function DrawerLink({
  to,
  icon,
  label,
  badge,
  active,
  onNavigate,
  testId,
}: {
  to: string
  icon: ComponentType<LucideProps>
  label: string
  badge?: number
  active: boolean
  onNavigate: () => void
  testId?: string
}) {
  const Icon = icon
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
      data-testid={testId ?? 'mobile-drawer-link'}
      onClick={onNavigate}
      className={cn(
        'flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[color:var(--hv-fg-subtle)] transition-colors',
        active && 'bg-[var(--hv-bg-raised)] text-[color:var(--hv-fg)] shadow-[inset_3px_0_0_var(--hv-button-primary-bg)]',
      )}
    >
      <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && badge > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--hv-accent-danger-wash)] px-1.5 text-[10px] font-medium text-[color:var(--hv-accent-danger)]">
          {badge}
        </span>
      ) : null}
    </Link>
  )
}

export function MobileNavigationDrawer({ modules, pendingCount }: MobileNavigationDrawerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const location = useLocation()
  const locationSignature = `${location.pathname}${location.search}${location.hash}`
  const [searchParams] = useSearchParams()
  const moduleGraph = useModuleGraphContext()
  const touchStartXRef = useRef<number | null>(null)
  const previousLocationSignatureRef = useRef(locationSignature)
  const routeMetadata = useMemo(
    () => normalizeCommandRoomRouteMetadata(
      findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui'),
    ),
    [moduleGraph],
  )
  const surfaceParam = routeMetadata.mobile.surfaceParam
  const surfaceSearch = searchParams.get(surfaceParam)
  const destinations = useMemo<DrawerDestination[]>(
    () => selectMobileDrawerDestinations(modules).map((module) => ({
      ...module,
      path: withSurfaceQuery(module.path, surfaceParam, surfaceSearch),
      badge: module.routeId === 'approvals.mobile-inbox-ui' ? pendingCount : module.badge,
    })),
    [modules, pendingCount, surfaceParam, surfaceSearch],
  )
  const mainDestinations = destinations.filter((destination) => destination.routeId !== 'settings.mobile-ui')
  const settingsDestination = destinations.find((destination) => destination.routeId === 'settings.mobile-ui') ?? null
  const { data: sessions = [] } = useAgentSessions()
  const recentSessions = useMemo(
    () => toRecentSessions(sessions, search, routeMetadata, surfaceParam, surfaceSearch),
    [search, sessions, routeMetadata, surfaceParam, surfaceSearch],
  )
  const launchPath = withSurfaceQuery(routeMetadata.launch.path, surfaceParam, surfaceSearch)
  const newSessionActive = isExactPathActive(location.pathname, routeMetadata.launch.path)
  const drawerId = 'mobile-navigation-drawer'

  useEffect(() => {
    if (previousLocationSignatureRef.current === locationSignature) {
      return
    }
    previousLocationSignatureRef.current = locationSignature
    setOpen(false)
  }, [locationSignature])

  function closeDrawer(): void {
    setOpen(false)
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    touchStartXRef.current = event.clientX
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const startX = touchStartXRef.current
    touchStartXRef.current = null
    if (startX === null) {
      return
    }
    if (event.clientX - startX < -48) {
      closeDrawer()
    }
  }

  return (
    <>
      <header
        data-testid="mobile-drawer-header"
        className="shrink-0 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 pt-[env(safe-area-inset-top,0px)]"
      >
        <div className="flex h-14 items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Open navigation"
            aria-controls={drawerId}
            aria-expanded={open}
            data-testid="mobile-drawer-trigger"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-bg-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)]"
          >
            <Menu size={22} />
          </button>
          <div className="min-w-0 flex-1 truncate text-center text-base font-medium text-[color:var(--hv-fg)]">
            Herd
          </div>
          <Link
            to={launchPath}
            aria-label="New session"
            data-testid="mobile-drawer-header-new-session"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-bg-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)]"
          >
            <Plus size={22} />
          </Link>
        </div>
      </header>

      <DismissibleOverlay
        open={open}
        onClose={closeDrawer}
        title="Mobile navigation"
        position="left-drawer"
        backdropClassName="bg-black/35"
        contentClassName="flex h-[100dvh] w-[min(82vw,320px)] flex-col border-r border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-[var(--hv-shadow-block)] outline-none"
        contentProps={{
          id: drawerId,
          'data-testid': 'mobile-drawer',
          onPointerDown: handlePointerDown,
          onPointerUp: handlePointerUp,
        }}
      >
        <div
          data-testid="mobile-drawer-body"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3"
        >
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg)] px-3 text-[color:var(--hv-fg-subtle)]">
            <Search size={16} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--hv-fg)] outline-none placeholder:text-[color:var(--hv-fg-subtle)]"
            />
          </label>

          <DrawerLink
            to={launchPath}
            icon={Plus}
            label="New session"
            active={newSessionActive}
            onNavigate={closeDrawer}
            testId="mobile-drawer-new-session"
          />

          <div className="h-px bg-[var(--hv-border-hair)]" />

          <nav aria-label="Mobile primary navigation" className="grid gap-1">
            {mainDestinations.map((destination) => {
              const Icon = iconMap[destination.icon] ?? Circle
              return (
                <DrawerLink
                  key={destination.routeId}
                  to={destination.path}
                  icon={Icon}
                  label={destination.label}
                  badge={destination.badge}
                  active={isDrawerDestinationActive(location.pathname, destination)}
                  onNavigate={closeDrawer}
                />
              )
            })}
          </nav>

          <div className="h-px bg-[var(--hv-border-hair)]" />

          <section className="min-h-0 flex-1">
            <h2 className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--hv-fg-subtle)]">
              Recent
            </h2>
            <div className="mt-2 grid gap-1">
              {recentSessions.map((session) => (
                <DrawerLink
                  key={session.id}
                  to={session.href}
                  icon={Circle}
                  label={session.label}
                  active={false}
                  onNavigate={closeDrawer}
                  testId="mobile-drawer-recent-session"
                />
              ))}
              {recentSessions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[color:var(--hv-fg-subtle)]">No recent sessions</p>
              ) : null}
            </div>
          </section>

          {settingsDestination ? (
            <>
              <div className="h-px bg-[var(--hv-border-hair)]" />
              <DrawerLink
                to={settingsDestination.path}
                icon={Settings}
                label={settingsDestination.label}
                active={isDrawerDestinationActive(location.pathname, settingsDestination)}
                onNavigate={closeDrawer}
              />
            </>
          ) : null}
        </div>
      </DismissibleOverlay>
    </>
  )
}
