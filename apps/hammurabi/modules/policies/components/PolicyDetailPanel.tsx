import { ArrowLeft, Clock3, ShieldCheck, Sparkles } from 'lucide-react'
import { StringArrayInput } from '@/components/string-array-input'
import {
  type ActionPolicyMode,
  type ActionPolicySettings,
} from '@/hooks/use-action-policies'
import { cn } from '@/lib/utils'

type PolicyGroup = 'Channels' | 'Code & Infra' | 'Skills' | 'Default'

export interface PolicyDetailRow {
  actionId: string
  name: string
  description: string
  group: PolicyGroup
  kind: 'action' | 'skill'
  policy: ActionPolicyMode
  allowlist: string[]
  blocklist: string[]
  targetLabel?: string
  allowPlaceholder?: string
  blockPlaceholder?: string
  supportsLists: boolean
  supportedProviders?: string[]
  source?: string
}

const POLICY_OPTIONS: Array<{ value: ActionPolicyMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'review', label: 'Review' },
  { value: 'block', label: 'Block' },
] as const

const TIMEOUT_MINUTE_OPTIONS = [5, 10, 15, 30, 60] as const

const POLICY_BADGE_CLASSES: Record<ActionPolicyMode, string> = {
  auto: 'badge-active',
  review: 'bg-accent-gold/15 text-sumi-black',
  block: 'bg-accent-vermillion/10 text-accent-vermillion',
}

function providerBadges(row: PolicyDetailRow): string[] {
  if (row.kind !== 'skill') {
    return []
  }

  const providers = row.supportedProviders?.map((provider) => provider.trim()).filter(Boolean) ?? []
  return providers.length > 0 ? providers : ['Unspecified']
}

export function PolicyDetailPanel({
  row,
  settings,
  inherited,
  inheritedLabel,
  isSaving,
  settingsSaving,
  onBack,
  onUpdatePolicy,
  onUpdateSettings,
}: {
  row: PolicyDetailRow | null
  settings: ActionPolicySettings
  inherited: boolean
  inheritedLabel: string
  isSaving: boolean
  settingsSaving: boolean
  onBack: () => void
  onUpdatePolicy: (nextValues: Partial<Pick<PolicyDetailRow, 'policy' | 'allowlist' | 'blocklist'>>) => void
  onUpdateSettings: (settings: ActionPolicySettings) => void
}) {
  if (!row) {
    return (
      <div
        data-testid="policy-detail-pane"
        className="flex h-full flex-1 flex-col items-center justify-center px-6 text-center text-sm text-sumi-diluted"
      >
        <ShieldCheck size={24} className="mb-3 text-sumi-mist" />
        <p>Select a policy to view details.</p>
      </div>
    )
  }

  const targetLabel = row.targetLabel ?? 'target'
  const providers = providerBadges(row)

  return (
    <div data-testid="policy-detail-pane" className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="space-y-3 border-b border-ink-border bg-washi-aged/30 px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-sumi-gray transition-colors hover:text-sumi-black"
        >
          <ArrowLeft size={16} />
          Policies
        </button>
      </div>

      <header className="border-b border-ink-border bg-washi-aged/20 px-4 py-4 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {row.kind === 'skill' ? (
                <Sparkles size={16} className="text-sumi-diluted" />
              ) : (
                <ShieldCheck size={16} className="text-sumi-diluted" />
              )}
              <h2 className="truncate font-mono text-base text-sumi-black">{row.name}</h2>
              <span className={cn('badge-sumi', POLICY_BADGE_CLASSES[row.policy])}>
                {row.policy}
              </span>
              <span
                className={cn(
                  'badge-sumi',
                  inherited ? 'bg-ink-wash text-sumi-diluted' : 'badge-active',
                )}
              >
                {inheritedLabel}
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sumi-diluted">{row.description}</p>
          </div>

          <div className="w-full shrink-0 lg:w-56">
            <label className="section-title mb-1.5 block" htmlFor={`policy-detail-select-${row.actionId}`}>
              Policy
            </label>
            <select
              id={`policy-detail-select-${row.actionId}`}
              value={row.policy}
              disabled={isSaving}
              onChange={(event) =>
                onUpdatePolicy({
                  policy: event.target.value as ActionPolicyMode,
                })
              }
              className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist disabled:cursor-not-allowed disabled:opacity-70"
            >
              {POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div data-testid="policy-detail-scroll" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="space-y-4">
          {row.kind === 'skill' ? (
            <section
              data-testid="policy-detail-providers"
              className="rounded-lg border border-ink-border bg-white/60 p-4"
            >
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-sumi-diluted" />
                <p className="section-title">Supported Providers</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {providers.map((provider) => (
                  <span key={provider} className="badge-sumi">
                    {provider}
                  </span>
                ))}
                {providers[0] === 'Unspecified' && row.source ? (
                  <span className="badge-sumi bg-ink-wash text-sumi-diluted">
                    Source: {row.source}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-ink-border bg-white/60 p-4">
            <div className="flex items-center gap-2">
              <Clock3 size={15} className="text-sumi-diluted" />
              <p className="section-title">Queue Defaults</p>
              {settingsSaving ? <span className="badge-sumi">Saving...</span> : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="section-title mb-1.5 block" htmlFor="approval-timeout-minutes">
                  Timeout Window
                </label>
                <select
                  id="approval-timeout-minutes"
                  value={settings.timeoutMinutes}
                  disabled={settingsSaving}
                  onChange={(event) =>
                    onUpdateSettings({
                      ...settings,
                      timeoutMinutes: Number.parseInt(event.target.value, 10) || settings.timeoutMinutes,
                    })
                  }
                  className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {TIMEOUT_MINUTE_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minute{minutes === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="section-title mb-1.5 block" htmlFor="approval-timeout-action">
                  No-Response Action
                </label>
                <select
                  id="approval-timeout-action"
                  value={settings.timeoutAction}
                  disabled={settingsSaving}
                  onChange={(event) =>
                    onUpdateSettings({
                      ...settings,
                      timeoutAction: event.target.value === 'auto' ? 'auto' : 'block',
                    })
                  }
                  className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <option value="block">Reject after timeout</option>
                  <option value="auto">Auto-approve after timeout</option>
                </select>
              </div>
            </div>
          </section>

          {row.supportsLists ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <StringArrayInput
                label={`Auto-approve when ${targetLabel} matches`}
                description={`Patterns here bypass review for ${row.name.toLowerCase()} when the ${targetLabel} matches.`}
                values={row.allowlist}
                placeholder={row.allowPlaceholder}
                emptyMessage={`No auto-approve patterns for ${row.name.toLowerCase()} yet.`}
                addLabel="Add allow rule"
                disabled={isSaving}
                onChange={(nextAllowlist) => onUpdatePolicy({ allowlist: nextAllowlist })}
              />

              <StringArrayInput
                label={`Always block when ${targetLabel} matches`}
                description={`Patterns here force ${row.name.toLowerCase()} to block before it reaches an external target.`}
                values={row.blocklist}
                placeholder={row.blockPlaceholder}
                emptyMessage={`No block patterns for ${row.name.toLowerCase()} yet.`}
                addLabel="Add block rule"
                disabled={isSaving}
                onChange={(nextBlocklist) => onUpdatePolicy({ blocklist: nextBlocklist })}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
