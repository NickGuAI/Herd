import { useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import {
  useActionPolicies,
  usePolicySettings,
  usePolicyCommanders,
  useUpdateActionPolicy,
  useUpdatePolicySettings,
  type ActionPolicyKind,
  type ActionPolicyMode,
  type ActionPolicyRecord,
  type ActionPolicyScope,
} from '@/hooks/use-action-policies'
import { useSkills } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'
import {
  PolicyDetailPanel,
  type PolicyDetailRow,
} from './components/PolicyDetailPanel'

type PolicyGroup = PolicyDetailRow['group']

interface BasePolicyRow {
  actionId: string
  name: string
  description: string
  group: PolicyGroup
  kind: ActionPolicyKind
  targetLabel?: string
  allowPlaceholder?: string
  blockPlaceholder?: string
  supportsLists: boolean
  supportedProviders?: string[]
  source?: string
}

interface DisplayPolicyRow extends BasePolicyRow {
  policy: ActionPolicyMode
  allowlist: string[]
  blocklist: string[]
  sourceScope?: string
  scope?: string
}

const BUILT_IN_ACTIONS: BasePolicyRow[] = [
  {
    actionId: 'send-email',
    name: 'Send Email',
    description: 'External email sends and drafts that reach recipients outside the workspace.',
    group: 'Channels',
    kind: 'action',
    targetLabel: 'recipient',
    allowPlaceholder: '*@gehirn.ai',
    blockPlaceholder: '*@external-client.com',
    supportsLists: true,
  },
  {
    actionId: 'send-message',
    name: 'Send Message',
    description: 'Outbound chat, DM, and messaging sends across Slack, Discord, WhatsApp, Telegram, and similar channels.',
    group: 'Channels',
    kind: 'action',
    targetLabel: 'channel or recipient',
    allowPlaceholder: 'slack:#ops',
    blockPlaceholder: 'telegram:*',
    supportsLists: true,
  },
  {
    actionId: 'post-social',
    name: 'Post to Social',
    description: 'Publishing content to social platforms such as X, LinkedIn, Circle, or similar networks.',
    group: 'Channels',
    kind: 'action',
    targetLabel: 'platform',
    allowPlaceholder: 'linkedin',
    blockPlaceholder: 'x',
    supportsLists: true,
  },
  {
    actionId: 'push-code-prs',
    name: 'Push Code / PRs',
    description: 'Git pushes, pull request creation, and related code publication actions.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'repo or branch',
    allowPlaceholder: 'NickGuAI/*',
    blockPlaceholder: 'main',
    supportsLists: true,
  },
  {
    actionId: 'deploy',
    name: 'Deploy',
    description: 'Deploys to external services and environments, including production workflows.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'service or environment',
    allowPlaceholder: 'staging',
    blockPlaceholder: 'production',
    supportsLists: true,
  },
  {
    actionId: 'publish-content',
    name: 'Publish Content',
    description: 'Publishing content to external platforms such as docs, reports, blogs, and workspace tools.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'target platform',
    allowPlaceholder: 'notion',
    blockPlaceholder: 'blog:public',
    supportsLists: true,
  },
  {
    actionId: 'calendar-changes',
    name: 'Calendar Changes',
    description: 'Creating or updating external calendar events and related scheduling actions.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'calendar or event',
    allowPlaceholder: 'primary',
    blockPlaceholder: 'team@group.calendar.google.com',
    supportsLists: true,
  },
] as const

const FALLBACK_ACTION_ID = 'everything-else'

const FALLBACK_ROW: BasePolicyRow = {
  actionId: FALLBACK_ACTION_ID,
  name: 'Everything Else',
  description: 'Fallback policy for unmatched external actions.',
  group: 'Default',
  kind: 'action',
  supportsLists: false,
}

const POLICY_BADGE_CLASSES: Record<ActionPolicyMode, string> = {
  auto: 'badge-active',
  review: 'bg-accent-gold/15 text-sumi-black',
  block: 'bg-accent-vermillion/10 text-accent-vermillion',
}

function parseApiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unexpected error'
  }

  const match = error.message.match(/^Request failed \(\d+\): (.+)$/s)
  const raw = match?.[1] ?? error.message

  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string }
    return parsed.error ?? parsed.message ?? error.message
  } catch {
    return raw
  }
}

function findPolicyRecord(
  records: ActionPolicyRecord[],
  row: Pick<BasePolicyRow, 'actionId' | 'name' | 'kind'>,
): ActionPolicyRecord | null {
  const rowNameLower = row.name.toLowerCase()

  return (
    records.find((record) => {
      const recordId = record.actionId || record.id
      if (recordId === row.actionId) {
        return true
      }

      if (record.kind !== row.kind) {
        return false
      }

      return record.name.toLowerCase() === rowNameLower
    }) ?? null
  )
}

function buildBuiltInRows(records: ActionPolicyRecord[]): DisplayPolicyRow[] {
  return BUILT_IN_ACTIONS.map((row) => {
    const record = findPolicyRecord(records, row)
    return {
      ...row,
      policy: record?.policy ?? 'review',
      allowlist: record?.allowlist ?? [],
      blocklist: record?.blocklist ?? [],
      sourceScope: record?.sourceScope,
      scope: record?.scope,
    }
  })
}

function buildSkillRows(
  records: ActionPolicyRecord[],
  skills: Array<{
    name: string
    description: string
    supportedProviders?: string[]
    source?: string
  }>,
): DisplayPolicyRow[] {
  return [...skills]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => {
      const baseRow: BasePolicyRow = {
        actionId: `skill:${skill.name}`,
        name: `/${skill.name}`,
        description:
          skill.description ||
          'User-invocable skill discovered automatically. Inner tool calls inherit this policy.',
        group: 'Skills',
        kind: 'skill',
        supportsLists: false,
        supportedProviders: skill.supportedProviders,
        source: skill.source,
      }
      const record =
        findPolicyRecord(records, baseRow) ??
        records.find((candidate) => candidate.actionId === skill.name || candidate.id === skill.name) ??
        null

      return {
        ...baseRow,
        policy: record?.policy ?? 'review',
        allowlist: record?.allowlist ?? [],
        blocklist: record?.blocklist ?? [],
        sourceScope: record?.sourceScope,
        scope: record?.scope,
      }
    })
}

function buildFallbackRow(records: ActionPolicyRecord[]): DisplayPolicyRow {
  const record = findPolicyRecord(records, FALLBACK_ROW)
  return {
    ...FALLBACK_ROW,
    policy: record?.policy ?? 'review',
    allowlist: [],
    blocklist: [],
    sourceScope: record?.sourceScope,
    scope: record?.scope,
  }
}

function isInheritedRow(row: DisplayPolicyRow, scope: ActionPolicyScope): boolean {
  if (scope === 'global') {
    return false
  }

  if (row.sourceScope) {
    return row.sourceScope !== scope
  }

  if (row.scope) {
    return row.scope !== scope
  }

  return true
}

function scopeLabel(scope: ActionPolicyScope, commanders: Array<{ id: string; displayName?: string; host: string }>): string {
  if (scope === 'global') {
    return 'Global'
  }

  const commanderId = scope.replace(/^commander:/, '')
  const commander = commanders.find((candidate) => candidate.id === commanderId)
  const label = commander?.displayName?.trim() || commander?.host || commanderId
  return `Commander: ${label}`
}

function rulesSummaryLabel(row: DisplayPolicyRow): string {
  if (row.group === 'Default') {
    return 'fallback'
  }
  if (!row.supportsLists) {
    return 'skill'
  }

  const totalRules = row.allowlist.length + row.blocklist.length
  return `${totalRules} rule${totalRules === 1 ? '' : 's'}`
}

function inheritedLabel(row: DisplayPolicyRow, scope: ActionPolicyScope): string {
  const inherited = isInheritedRow(row, scope)
  if (inherited) {
    return 'Inherited from Global'
  }
  return scope === 'global' ? 'Global Default' : 'Commander Override'
}

export default function PoliciesPage() {
  const [scope, setScope] = useState<ActionPolicyScope>('global')
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)

  const commandersQuery = usePolicyCommanders()
  const policiesQuery = useActionPolicies(scope)
  const settingsQuery = usePolicySettings()
  const skillsQuery = useSkills()
  const updatePolicy = useUpdateActionPolicy(scope)
  const updateSettings = useUpdatePolicySettings()

  const commanders = commandersQuery.data ?? []
  const skills = (skillsQuery.data ?? [])
    .filter((skill) => skill.userInvocable)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      supportedProviders: skill.supportedProviders,
      source: skill.source,
    }))
  const records = policiesQuery.data ?? []
  const settings = settingsQuery.data ?? {
    timeoutMinutes: 15,
    timeoutAction: 'block' as const,
    standingApprovalExpiryDays: 30,
  }

  const builtInRows = buildBuiltInRows(records)
  const channelsRows = builtInRows.filter((row) => row.group === 'Channels')
  const codeInfraRows = builtInRows.filter((row) => row.group === 'Code & Infra')
  const skillRows = buildSkillRows(records, skills)
  const fallbackRow = buildFallbackRow(records)

  const groups: Array<{ label: PolicyGroup; rows: DisplayPolicyRow[] }> = [
    { label: 'Skills', rows: skillRows },
    { label: 'Channels', rows: channelsRows },
    { label: 'Code & Infra', rows: codeInfraRows },
    { label: 'Default', rows: [fallbackRow] },
  ]
  const policyRows = groups.flatMap((group) => group.rows)
  const hasSelectedRow = Boolean(
    selectedActionId && policyRows.some((row) => row.actionId === selectedActionId),
  )
  const activeActionId = hasSelectedRow ? selectedActionId : policyRows[0]?.actionId ?? null
  const selectedRow = policyRows.find((row) => row.actionId === activeActionId) ?? null
  const showDetailOnMobile = hasSelectedRow

  const pageError =
    (policiesQuery.error instanceof Error ? parseApiErrorMessage(policiesQuery.error) : null) ??
    (settingsQuery.error instanceof Error ? parseApiErrorMessage(settingsQuery.error) : null) ??
    (commandersQuery.error instanceof Error ? parseApiErrorMessage(commandersQuery.error) : null) ??
    (skillsQuery.error instanceof Error ? parseApiErrorMessage(skillsQuery.error) : null)
  const mutationError =
    (updatePolicy.error instanceof Error ? parseApiErrorMessage(updatePolicy.error) : null) ??
    (updateSettings.error instanceof Error ? parseApiErrorMessage(updateSettings.error) : null)

  function handlePolicyUpdate(
    row: DisplayPolicyRow,
    nextValues: Partial<Pick<DisplayPolicyRow, 'policy' | 'allowlist' | 'blocklist'>>,
  ) {
    updatePolicy.mutate({
      scope,
      actionId: row.actionId,
      id: row.actionId,
      name: row.name,
      kind: row.kind,
      policy: nextValues.policy ?? row.policy,
      allowlist: nextValues.allowlist ?? row.allowlist,
      blocklist: nextValues.blocklist ?? row.blocklist,
      description: row.description,
      group: row.group,
      targetLabel: row.targetLabel,
    })
  }

  return (
    <section
      aria-labelledby="policies-page-title"
      data-testid="policies-page"
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-washi-white"
    >
      {(pageError || mutationError) && (
        <div className="flex shrink-0 items-start gap-2 border-b border-ink-border bg-accent-vermillion/10 px-4 py-2 text-sm text-accent-vermillion">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{mutationError ?? pageError}</span>
        </div>
      )}

      <div data-testid="policies-page-content" className="flex min-h-0 flex-1 overflow-hidden">
        <div
          data-testid="policy-list-pane"
          className={cn(
            'flex flex-col overflow-hidden border-r border-ink-border bg-washi-aged/10',
            showDetailOnMobile ? 'hidden md:flex' : 'flex',
            'w-full shrink-0 md:w-64 lg:w-72',
          )}
        >
          <header className="shrink-0 border-b border-ink-border bg-washi-aged/30 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-sumi-diluted" />
                  <h2 id="policies-page-title" className="font-display text-lg text-sumi-black">
                    Policies
                  </h2>
                </div>
                <p className="mt-1 truncate text-xs text-sumi-diluted">
                  {scopeLabel(scope, commanders)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void Promise.all([
                    policiesQuery.refetch(),
                    settingsQuery.refetch(),
                    commandersQuery.refetch(),
                    skillsQuery.refetch(),
                  ])
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-border text-sumi-diluted transition-colors hover:bg-ink-wash hover:text-sumi-black"
                aria-label="Refresh policies"
              >
                <RefreshCw
                  size={14}
                  className={
                    policiesQuery.isFetching || commandersQuery.isFetching || skillsQuery.isFetching
                    || settingsQuery.isFetching
                      ? 'animate-spin'
                      : ''
                  }
                />
              </button>
            </div>

            <label className="section-title mt-4 block" htmlFor="policies-scope-select">
              Scope
            </label>
            <select
              id="policies-scope-select"
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as ActionPolicyScope)
                setSelectedActionId(null)
              }}
              className="mt-1.5 w-full rounded-lg border border-ink-border bg-washi-white px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist"
            >
              <option value="global">Global</option>
              {commanders.map((commander) => (
                <option key={commander.id} value={`commander:${commander.id}`}>
                  Commander: {commander.displayName?.trim() || commander.host}
                </option>
              ))}
            </select>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-4">
              {groups.map(({ label, rows }) => (
                <section key={label} aria-labelledby={`policy-group-${label.replace(/\W+/g, '-').toLowerCase()}`}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    {label === 'Skills' ? (
                      <Sparkles size={13} className="text-sumi-diluted" />
                    ) : (
                      <ShieldCheck size={13} className="text-sumi-diluted" />
                    )}
                    <h3
                      id={`policy-group-${label.replace(/\W+/g, '-').toLowerCase()}`}
                      className="section-title"
                    >
                      {label}
                    </h3>
                  </div>

                  {rows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-ink-border px-3 py-4 text-sm text-sumi-diluted">
                      No user-invocable skills discovered.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rows.map((row) => {
                        const selected = row.actionId === activeActionId
                        const inherited = isInheritedRow(row, scope)
                        const savingThisRow =
                          updatePolicy.isPending &&
                          updatePolicy.variables?.actionId === row.actionId

                        return (
                          <button
                            key={row.actionId}
                            type="button"
                            data-testid={`policy-row-${row.actionId}`}
                            aria-current={selected ? 'true' : undefined}
                            onClick={() => setSelectedActionId(row.actionId)}
                            className={cn(
                              'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                              selected
                                ? 'border-sumi-mist bg-white shadow-sm'
                                : 'border-transparent hover:border-ink-border hover:bg-white/60',
                            )}
                          >
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-mono text-sm text-sumi-black">{row.name}</p>
                                <p className="mt-1 truncate text-xs text-sumi-diluted">
                                  {rulesSummaryLabel(row)}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  'badge-sumi shrink-0',
                                  POLICY_BADGE_CLASSES[row.policy],
                                )}
                              >
                                {row.policy}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span
                                className={cn(
                                  'badge-sumi',
                                  inherited ? 'bg-ink-wash text-sumi-diluted' : 'badge-active',
                                )}
                              >
                                {inherited ? 'Inherited' : scope === 'global' ? 'Global' : 'Override'}
                              </span>
                              {savingThisRow ? <span className="badge-sumi">Saving...</span> : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        </div>

        <div
          data-testid="policy-detail-shell"
          className={cn(
            'min-w-0 flex-1',
            showDetailOnMobile ? 'flex' : 'hidden md:flex',
          )}
        >
          <PolicyDetailPanel
            row={selectedRow}
            settings={settings}
            inherited={selectedRow ? isInheritedRow(selectedRow, scope) : false}
            inheritedLabel={selectedRow ? inheritedLabel(selectedRow, scope) : ''}
            isSaving={Boolean(
              selectedRow &&
              updatePolicy.isPending &&
              updatePolicy.variables?.actionId === selectedRow.actionId,
            )}
            settingsSaving={updateSettings.isPending}
            onBack={() => setSelectedActionId(null)}
            onUpdatePolicy={(nextValues) => {
              if (selectedRow) {
                handlePolicyUpdate(selectedRow, nextValues)
              }
            }}
            onUpdateSettings={(nextSettings) => updateSettings.mutate(nextSettings)}
          />
        </div>
      </div>
    </section>
  )
}
