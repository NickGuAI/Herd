import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMachines } from '@/hooks/use-agents'
import {
  usePolicySettings,
  useUpdatePolicySettings,
  type ActionPolicySettings,
} from '@/hooks/use-action-policies'
import { useTelemetrySummary } from '@/hooks/use-telemetry'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'
import { useFounderProfile } from '@modules/operators/hooks/useFounderProfile'
import TelemetryPreviewCard from '@modules/telemetry/components/TelemetryPreviewCard'
import {
  MOBILE_SETTINGS_BASE_PATH,
  MOBILE_SETTINGS_SECTIONS,
  getMobileSettingsPath,
  getMobileSettingsSection,
  type MobileSettingsSection,
} from './mobile-settings-sections'

/**
 * Version + build identifiers. `APP_VERSION` is read from `package.json` at
 * build time via a lightweight `import.meta.env` bridge — the Vite config
 * exposes `import.meta.env.VITE_APP_VERSION` which defaults to the
 * package.json version string. `BUILD_COMMIT` is the short SHA the server
 * wrapper injects at launch time via `VITE_BUILD_COMMIT` (falls back to
 * empty so the footer just shows the version).
 */
const APP_VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.1.0'
const BUILD_COMMIT = (import.meta.env?.VITE_BUILD_COMMIT as string | undefined) ?? ''

const DEFAULT_POLICY_SETTINGS = {
  timeoutMinutes: 30,
  timeoutAction: 'block' as const,
  standingApprovalExpiryDays: 30,
} satisfies ActionPolicySettings

interface MobileSettingsProfile {
  displayName: string
  email: string
  picture: string | null
  onSignOut?: () => void
}

function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || 'Hervald'
  const [first = 'H', second = 'A'] = source.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toLowerCase()
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function activeSectionFromPath(pathname: string): MobileSettingsSection | null {
  const prefix = `${MOBILE_SETTINGS_BASE_PATH}/`
  if (!pathname.startsWith(prefix)) {
    return null
  }
  const [sectionId] = pathname.slice(prefix.length).split('/')
  return getMobileSettingsSection(sectionId)
}

function withSearch(path: string, search: string): string {
  return search ? `${path}${search}` : path
}

function SettingsHeader({
  title,
  backTo,
}: {
  title: string
  backTo?: string
}) {
  return (
    <div className="px-5 pb-3 pt-4">
      {backTo ? (
        <Link
          to={backTo}
          className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-ink-border/70 bg-washi-white text-sumi-black"
          aria-label="Back to settings"
        >
          <ArrowLeft size={16} />
        </Link>
      ) : (
        <p className="text-[10px] uppercase tracking-[0.18em] text-sumi-diluted">hervald</p>
      )}
      <h1 className="mt-1 font-display text-4xl text-sumi-black">{title}</h1>
    </div>
  )
}

function SettingsPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(
      'rounded-[3px_14px_3px_14px] border border-ink-border/70 bg-washi-white px-4 py-4',
      className,
    )}>
      {children}
    </div>
  )
}

function ProfileCard({
  profile,
  className,
}: {
  profile: MobileSettingsProfile
  className?: string
}) {
  return (
    <SettingsPanel className={cn('mx-4', className)}>
      <div className="flex items-center gap-3">
        {profile.picture ? (
          <img
            src={profile.picture}
            alt={profile.displayName}
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sumi-black font-display text-lg italic text-washi-white">
            {initials(profile.displayName, profile.email)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-sumi-black">
            {profile.displayName}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-sumi-diluted">
            {profile.email}
          </p>
        </div>

        <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-moss-stone">
          active
        </span>
      </div>

      {profile.onSignOut ? (
        <button
          type="button"
          onClick={profile.onSignOut}
          className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-sumi-diluted transition-colors hover:text-sumi-black"
        >
          <LogOut size={13} />
          Sign out
        </button>
      ) : null}
    </SettingsPanel>
  )
}

function FullPageLink({ section }: { section: MobileSettingsSection }) {
  if (!section.fullPagePath) {
    return null
  }

  return (
    <Link
      to={section.fullPagePath}
      className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-sumi-diluted transition-colors hover:text-sumi-black"
    >
      Open full page
      <ExternalLink size={13} />
    </Link>
  )
}

function MobileSettingsIndex({
  profile,
  search,
}: {
  profile: MobileSettingsProfile
  search: string
}) {
  return (
    <>
      <SettingsHeader title="Settings" />

      <div className="hv-scroll flex-1 overflow-y-auto px-0 pb-5">
        <ProfileCard profile={profile} />

        <div className="mt-4 px-3">
          <div className="overflow-hidden rounded-[3px_14px_3px_14px] border border-ink-border/70 bg-washi-white">
            {MOBILE_SETTINGS_SECTIONS.map((section, index) => {
              const Icon = section.icon
              return (
                <Link
                  key={section.id}
                  to={withSearch(getMobileSettingsPath(section.id), search)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-sumi-black transition-colors hover:bg-ink-wash/40"
                  style={{
                    borderBottom: index < MOBILE_SETTINGS_SECTIONS.length - 1
                      ? '1px solid var(--hv-border-hair)'
                      : 'none',
                  }}
                >
                  <Icon size={15} className="shrink-0 text-sumi-diluted" />
                  <span className="flex-1">{section.label}</span>
                  <ChevronRight size={14} className="text-sumi-mist" />
                </Link>
              )
            })}
          </div>
        </div>

        <div className="px-4 pt-5">
          <TelemetryPreviewCard />
        </div>

        <VersionFooter />
      </div>
    </>
  )
}

function AccountPanel({
  profile,
  section,
}: {
  profile: MobileSettingsProfile
  section: MobileSettingsSection
}) {
  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} className="mx-0" />
      <SettingsPanel>
        <div className="space-y-3 text-sm">
          <SettingRow label="Display name" value={profile.displayName} />
          <SettingRow label="Email" value={profile.email} />
        </div>
        <FullPageLink section={section} />
      </SettingsPanel>
    </div>
  )
}

function TelemetryPanel({ section }: { section: MobileSettingsSection }) {
  const summaryQuery = useTelemetrySummary()
  const summary = summaryQuery.data

  if (summaryQuery.isLoading && !summary) {
    return <SettingsPanel>Loading telemetry...</SettingsPanel>
  }

  if (summaryQuery.error && !summary) {
    return <SettingsPanel>Telemetry is unavailable.</SettingsPanel>
  }

  return (
    <SettingsPanel>
      {summary ? (
        <div className="space-y-3 text-sm">
          <SettingRow label="Today" value={formatCost(summary.costToday)} />
          <SettingRow label="This week" value={formatCost(summary.costWeek)} />
          <SettingRow label="This month" value={formatCost(summary.costMonth)} />
          <SettingRow
            label="Sessions"
            value={`${summary.activeSessions} active / ${summary.totalSessions} total`}
          />
          <SettingRow label="Tokens today" value={formatNumber(summary.totalTokensToday)} />
          <SettingRow label="Top model" value={summary.topModels[0]?.model ?? 'None'} />
        </div>
      ) : (
        <p className="text-sm text-sumi-diluted">No telemetry summary is available.</p>
      )}
      <FullPageLink section={section} />
    </SettingsPanel>
  )
}

function NotificationsPanel({ section }: { section: MobileSettingsSection }) {
  const settingsQuery = usePolicySettings()
  const updateSettings = useUpdatePolicySettings()
  const settings = settingsQuery.data ?? DEFAULT_POLICY_SETTINGS
  const disabled = settingsQuery.isLoading || updateSettings.isPending

  function update(patch: Partial<ActionPolicySettings>) {
    updateSettings.mutate({
      ...settings,
      ...patch,
    })
  }

  return (
    <SettingsPanel>
      <div className="space-y-4">
        <label className="block text-xs uppercase tracking-[0.08em] text-sumi-diluted">
          Timeout action
          <select
            value={settings.timeoutAction}
            disabled={disabled}
            onChange={(event) => update({ timeoutAction: event.target.value as 'auto' | 'block' })}
            className="mt-2 w-full rounded-md border border-ink-border bg-washi-white px-3 py-2 text-sm normal-case tracking-normal text-sumi-black"
          >
            <option value="block">Block when unanswered</option>
            <option value="auto">Auto-approve when unanswered</option>
          </select>
        </label>

        <label className="block text-xs uppercase tracking-[0.08em] text-sumi-diluted">
          Timeout minutes
          <input
            type="number"
            min={1}
            value={settings.timeoutMinutes}
            disabled={disabled}
            onChange={(event) => update({
              timeoutMinutes: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
            })}
            className="mt-2 w-full rounded-md border border-ink-border bg-washi-white px-3 py-2 text-sm normal-case tracking-normal text-sumi-black"
          />
        </label>

        <label className="block text-xs uppercase tracking-[0.08em] text-sumi-diluted">
          Standing approval days
          <input
            type="number"
            min={1}
            value={settings.standingApprovalExpiryDays}
            disabled={disabled}
            onChange={(event) => update({
              standingApprovalExpiryDays: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
            })}
            className="mt-2 w-full rounded-md border border-ink-border bg-washi-white px-3 py-2 text-sm normal-case tracking-normal text-sumi-black"
          />
        </label>
      </div>
      <FullPageLink section={section} />
    </SettingsPanel>
  )
}

function MachinesPanel() {
  const machinesQuery = useMachines()
  const machines = machinesQuery.data ?? []

  if (machinesQuery.isLoading && machines.length === 0) {
    return <SettingsPanel>Loading machines...</SettingsPanel>
  }

  if (machinesQuery.error && machines.length === 0) {
    return <SettingsPanel>Machines are unavailable.</SettingsPanel>
  }

  return (
    <SettingsPanel>
      <div className="space-y-3">
        <SettingRow label="Registered" value={formatNumber(machines.length)} />
        {machines.length === 0 ? (
          <p className="text-sm text-sumi-diluted">No machines are registered.</p>
        ) : (
          <div className="space-y-2">
            {machines.map((machine) => (
              <div
                key={machine.id}
                className="rounded-md border border-ink-border/70 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-sumi-black">
                    {machine.label || machine.id}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-sumi-diluted">
                    {machine.host ? 'remote' : 'local'}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-sumi-diluted">
                  {machine.host ?? 'localhost'}
                </p>
                {machine.cwd ? (
                  <p className="mt-1 truncate font-mono text-[10px] text-sumi-mist">
                    {machine.cwd}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsPanel>
  )
}

function AppearancePanel() {
  const { theme, setTheme, isLoading, isSaving } = useTheme()
  const disabled = isLoading || isSaving

  return (
    <SettingsPanel>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTheme('light')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm transition-colors',
            theme === 'light'
              ? 'border-sumi-black bg-sumi-black text-washi-white'
              : 'border-ink-border bg-washi-white text-sumi-black',
          )}
        >
          <Sun size={15} />
          Light
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTheme('dark')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm transition-colors',
            theme === 'dark'
              ? 'border-sumi-black bg-sumi-black text-washi-white'
              : 'border-ink-border bg-washi-white text-sumi-black',
          )}
        >
          <Moon size={15} />
          Dark
        </button>
      </div>
    </SettingsPanel>
  )
}

function AboutPanel() {
  return (
    <SettingsPanel>
      <div className="space-y-3 text-sm">
        <SettingRow label="Product" value="Hervald" />
        <SettingRow label="Version" value={APP_VERSION} />
        {BUILD_COMMIT ? <SettingRow label="Build" value={BUILD_COMMIT} /> : null}
      </div>
    </SettingsPanel>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-border/70 py-2 last:border-b-0">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-sumi-diluted">
        {label}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-sumi-black">
        {value}
      </span>
    </div>
  )
}

function MobileSettingsDetail({
  section,
  profile,
  search,
}: {
  section: MobileSettingsSection
  profile: MobileSettingsProfile
  search: string
}) {
  return (
    <>
      <SettingsHeader
        title={section.label}
        backTo={withSearch(MOBILE_SETTINGS_BASE_PATH, search)}
      />
      <div className="hv-scroll flex-1 overflow-y-auto px-4 pb-5">
        {section.id === 'account' ? <AccountPanel profile={profile} section={section} /> : null}
        {section.id === 'telemetry' ? <TelemetryPanel section={section} /> : null}
        {section.id === 'notifications' ? <NotificationsPanel section={section} /> : null}
        {section.id === 'machines' ? <MachinesPanel /> : null}
        {section.id === 'appearance' ? <AppearancePanel /> : null}
        {section.id === 'about' ? <AboutPanel /> : null}
        <VersionFooter />
      </div>
    </>
  )
}

function VersionFooter() {
  return (
    <div className="px-6 pt-4 text-center text-[10px] uppercase tracking-[0.14em] text-sumi-mist">
      hervald · v{APP_VERSION}{BUILD_COMMIT ? ` · build ${BUILD_COMMIT}` : ''}
    </div>
  )
}

export function MobileSettings() {
  const auth = useAuth()
  const { data: founder } = useFounderProfile()
  const location = useLocation()
  const user = auth?.user
  const profile: MobileSettingsProfile = {
    displayName: founder?.displayName ?? user?.name ?? 'Operator',
    email: founder?.email ?? user?.email ?? 'Signed in with an API key',
    picture: founder?.avatarUrl ?? user?.picture ?? null,
    onSignOut: auth?.signOut,
  }
  const section = activeSectionFromPath(location.pathname)

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-settings">
      {section ? (
        <MobileSettingsDetail
          section={section}
          profile={profile}
          search={location.search}
        />
      ) : (
        <MobileSettingsIndex profile={profile} search={location.search} />
      )}
    </section>
  )
}
