import { NavLink } from 'react-router-dom'
import type { LucideProps } from 'lucide-react'
import {
  Monitor,
  BarChart3,
  Server,
  Settings,
  Users,
  Crown,
  ClipboardCheck,
  Clock3,
  Swords,
  CalendarClock,
  FolderOpen,
  ShieldCheck,
  RadioTower,
  Sparkles,
  Circle,
} from 'lucide-react'
import type { FrontendNavItem } from '@/types'
import { cn } from '@/lib/utils'

const iconMap: Record<string, React.ComponentType<LucideProps>> = {
  Monitor,
  BarChart3,
  Server,
  Users,
  Crown,
  ClipboardCheck,
  Clock3,
  Swords,
  CalendarClock,
  FolderOpen,
  ShieldCheck,
  RadioTower,
  Sparkles,
  Circle,
  Settings,
}

interface BottomNavItem extends FrontendNavItem {
  badge?: number
}

export function BottomNav({
  modules,
  forceVisible = false,
}: {
  modules: BottomNavItem[]
  forceVisible?: boolean
}) {
  return (
    <nav
      aria-label="Primary mobile navigation"
      className={cn(
        'fixed bottom-0 left-0 right-0 z-20 flex min-h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] items-stretch justify-around border-t border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-1 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur',
        !forceVisible && 'md:hidden',
      )}
    >
      {modules.filter((mod) => !mod.hideFromNav && (mod.navGroup ?? 'primary') === 'primary').map((mod) => {
        const Icon = iconMap[mod.icon] ?? Circle
        return (
          <NavLink
            key={mod.name}
            to={mod.path}
            className={({ isActive }) =>
              cn(
                'relative flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 pt-1.5 pb-1 text-[color:var(--hv-fg-subtle)] transition-colors duration-200',
                isActive && 'text-[color:var(--hv-fg)]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative flex h-6 items-center justify-center">
                  {Icon && <Icon size={20} strokeWidth={isActive ? 2.3 : 1.8} />}
                  {mod.badge && mod.badge > 0 ? (
                    <span className="absolute right-[-8px] top-[-2px] inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--hv-accent-danger-wash)] px-1 text-[9px] font-medium leading-none text-[color:var(--hv-fg-inverse)]">
                      {mod.badge}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate text-[10px] font-medium leading-none">
                  {mod.label}
                </span>
                <span className={cn('absolute top-0 block h-0.5 w-5 rounded-full', isActive ? 'bg-[var(--hv-button-primary-bg)]' : 'bg-transparent')} />
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
