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
      className={cn(
        'fixed bottom-0 left-0 right-0 z-20 flex items-stretch justify-around border-t border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] pb-[env(safe-area-inset-bottom,0px)]',
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
                'flex flex-1 flex-col items-center justify-center gap-1 pt-2.5 pb-2 text-[color:var(--hv-fg)] transition-colors duration-300',
                isActive && 'text-[color:var(--hv-fg)]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  {Icon && <Icon size={24} />}
                  {mod.badge && mod.badge > 0 ? (
                    <span className="absolute right-[-6px] top-0 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--hv-accent-danger-wash)] px-1 text-[9px] font-medium leading-none text-[color:var(--hv-fg-inverse)]">
                      {mod.badge}
                    </span>
                  ) : null}
                </span>
                <span className="text-[12px] uppercase tracking-wider">
                  {mod.label}
                </span>
                <span className={cn('block w-1 h-1 rounded-full', isActive ? 'bg-[var(--hv-button-primary-bg)]' : 'bg-transparent')} />
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
