/**
 * Hervald — Dark top bar.
 *
 * Replaces the left sidebar. Full-width Hervald chrome.
 * Vermillion dot + italic "Hervald" branding, breadcrumb nav,
 * inline tab navigation, status counters, and ops overflow.
 */
import { NavLink, useLocation } from 'react-router-dom'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'

interface NavItem {
  name: string
  label: string
  path: string
  hideFromNav?: boolean
  navGroup?: 'primary' | 'secondary'
}

/** Status counts displayed in the top bar */
export interface TopBarCounts {
  running: number
  stale: number
  exited: number
  pending: number
}

interface TopBarProps {
  modules: NavItem[]
  counts?: TopBarCounts
}

/** Short uppercase labels for top bar tab nav */
const TAB_LABELS: Record<string, string> = {
  'command-room': 'Command Room',
  'api-keys': 'Settings',
  telemetry: 'Telemetry',
  services: 'Services',
  policies: 'Policies',
}

/** Breadcrumb labels (full names) */
const BREADCRUMB_LABELS: Record<string, string> = {
  'command-room': 'COMMAND ROOM',
  telemetry: 'TELEMETRY',
  services: 'SERVICES',
  policies: 'POLICIES',
  'api-keys': 'SETTINGS',
}

const headerStyle: CSSProperties = {
  height: 48,
  flexShrink: 0,
  padding: '0 22px',
  background: 'var(--hv-bg-raised)',
  color: 'var(--hv-fg)',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  borderBottom: '1px solid var(--hv-border-hair)',
}

const brandingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const dotStyle: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: 'var(--vermillion-seal)',
  display: 'inline-block',
}

const nameStyle: CSSProperties = {
  fontStyle: 'italic',
  fontSize: 15,
  color: 'var(--hv-fg)',
}

const separatorStyle: CSSProperties = {
  color: 'var(--hv-fg-faint)',
  margin: '0 4px',
}

const breadcrumbStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--hv-fg)',
}

const tabBase: CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 10px',
  fontSize: 13,
  color: 'var(--hv-fg)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  textDecoration: 'none',
}

const countersStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  fontSize: 10.5,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--hv-fg-subtle)',
}

const countValueStyle: CSSProperties = {
  color: 'var(--hv-fg)',
  fontWeight: 500,
}

const overflowButtonStyle: CSSProperties = {
  ...tabBase,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const overflowMenuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  minWidth: 180,
  padding: 8,
  background: 'var(--hv-bg-elevated)',
  border: '1px solid var(--hv-border-soft)',
  borderRadius: 10,
  boxShadow: 'var(--hv-shadow-modal)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  zIndex: 20,
}

const iconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  border: '1px solid var(--hv-border-soft)',
  borderRadius: 8,
  background: 'var(--hv-ink-wash-02)',
  color: 'var(--hv-fg)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

function isModuleActive(module: NavItem, pathname: string) {
  return pathname === module.path || pathname.startsWith(module.path + '/')
}

export function TopBar({ modules, counts }: TopBarProps) {
  const location = useLocation()
  const { theme, toggleTheme, isSaving } = useTheme()
  const [showOverflow, setShowOverflow] = useState(false)
  const overflowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showOverflow) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (!overflowRef.current?.contains(target)) {
        setShowOverflow(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showOverflow])

  // Resolve current module name from path
  const currentModule = modules.find(
    (m) => isModuleActive(m, location.pathname),
  )
  const breadcrumb = currentModule
    ? BREADCRUMB_LABELS[currentModule.name] || currentModule.label.toUpperCase()
    : 'COMMAND ROOM'

  const primaryTabs = modules.filter(
    (m) => !m.hideFromNav && (m.navGroup ?? 'primary') === 'primary',
  )
  const secondaryTabs = modules.filter(
    (m) => !m.hideFromNav && m.navGroup === 'secondary',
  )
  const activeSecondary = secondaryTabs.some((mod) => isModuleActive(mod, location.pathname))

  const { running = 0, stale = 0, exited = 0, pending = 0 } = counts || {}

  return (
    <header style={headerStyle}>
      {/* Branding */}
      <div style={brandingStyle}>
        <span style={dotStyle} />
        <span className="font-display" style={nameStyle}>Hervald</span>
      </div>

      <span style={separatorStyle}>/</span>

      {/* Breadcrumb — current page */}
      <span className="font-body" style={breadcrumbStyle}>{breadcrumb}</span>

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Tab navigation */}
      <nav style={{ display: 'flex', gap: 4, marginRight: 16 }}>
        {primaryTabs.map((mod) => (
          <NavLink
            key={mod.name}
            to={mod.path}
            className="font-body"
            style={({ isActive }) => ({
              ...tabBase,
              color: 'var(--hv-fg)',
              borderBottom: isActive
                ? '1px solid var(--hv-fg)'
                : '1px solid transparent',
            })}
          >
            {TAB_LABELS[mod.name] || mod.label}
          </NavLink>
        ))}
        {secondaryTabs.length > 0 && (
          <div ref={overflowRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="font-body"
              style={{
                ...overflowButtonStyle,
                color: 'var(--hv-fg)',
                borderBottom:
                  activeSecondary || showOverflow
                    ? '1px solid var(--hv-fg)'
                    : '1px solid transparent',
              }}
              onClick={() => setShowOverflow((current) => !current)}
            >
              Ops
            </button>
            {showOverflow && (
              <div style={overflowMenuStyle}>
                {secondaryTabs.map((mod) => (
                  <NavLink
                    key={mod.name}
                    to={mod.path}
                    onClick={() => setShowOverflow(false)}
                    className="font-body"
                    style={({ isActive }) => ({
                      ...tabBase,
                      color: 'var(--hv-fg)',
                      borderBottom: 'none',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isActive ? 'var(--hv-ink-wash-02)' : 'transparent',
                    })}
                  >
                    {TAB_LABELS[mod.name] || mod.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Status counters */}
      <div style={countersStyle}>
        <span>
          <b style={countValueStyle}>{running}</b> running
        </span>
      </div>

      <button
        type="button"
        style={{
          ...iconButtonStyle,
          opacity: isSaving ? 0.65 : 1,
        }}
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
        title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
        disabled={isSaving}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </header>
  )
}
