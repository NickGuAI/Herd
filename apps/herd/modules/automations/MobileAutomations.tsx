import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AutomationPanel } from '@modules/commanders/components/AutomationPanel'
import type { AutomationTriggerFilter } from '@modules/automations/hooks/useAutomations'
import { cn } from '@/lib/utils'

function readTriggerFilter(triggerValue: string | null): AutomationTriggerFilter {
  if (triggerValue === 'schedule' || triggerValue === 'quest' || triggerValue === 'manual') {
    return triggerValue
  }

  return 'all'
}

export interface MobileAutomationCommander {
  id: string
  host?: string
  displayName?: string
}

interface AutomationCommanderFilterProps {
  commanders: MobileAutomationCommander[]
  value: string
  onChange: (value: string) => void
  compact?: boolean
  selectTestId?: string
  wrapperTestId?: string
  className?: string
}

function commanderOptionLabel(commander: MobileAutomationCommander): string {
  return (commander.displayName?.trim() || commander.host?.trim() || commander.id).toLowerCase()
}

export function AutomationCommanderFilter({
  commanders,
  value,
  onChange,
  compact = false,
  selectTestId,
  wrapperTestId,
  className,
}: AutomationCommanderFilterProps) {
  return (
    <label
      className={cn(
        compact
          ? 'flex items-center gap-3 rounded-lg border border-ink-border bg-washi-white px-3 py-2'
          : 'block max-w-sm',
        className,
      )}
      data-testid={wrapperTestId}
    >
      <span className={cn('section-title', compact ? 'shrink-0 text-[10px]' : 'block mb-2')}>
        Commander
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'border border-ink-border bg-washi-white font-mono text-sumi-black focus:outline-none focus:border-ink-border-hover',
          compact
            ? 'min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-right text-[16px]'
            : 'w-full rounded-lg px-3 py-2 text-sm',
        )}
        data-testid={selectTestId}
      >
        <option value="global">global</option>
        {commanders.map((commander) => (
          <option key={commander.id} value={commander.id}>
            {commanderOptionLabel(commander)}
          </option>
        ))}
      </select>
    </label>
  )
}

function readCommanderFilter(value: string | null, commanders: MobileAutomationCommander[]): string {
  if (value && (value === 'global' || commanders.some((commander) => commander.id === value))) {
    return value
  }
  return 'global'
}

interface MobileAutomationsProps {
  commanders: MobileAutomationCommander[]
}

export function MobileAutomations({
  commanders,
}: MobileAutomationsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const triggerFilter = readTriggerFilter(searchParams.get('trigger'))
  const commanderFilter = readCommanderFilter(
    searchParams.get('commander'),
    commanders,
  )
  const preselectedSkillName = searchParams.get('skill')

  const scopeCommander = useMemo(
    () => commanders.find((commander) => commander.id === commanderFilter) ?? null,
    [commanders, commanderFilter],
  )

  function updateParams(patch: Record<string, string | null>) {
    const nextParams = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) {
        nextParams.set(key, value)
      } else {
        nextParams.delete(key)
      }
    }
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-automations">
      <div className="min-h-0 flex-1 overflow-hidden">
        <AutomationPanel
          presentation="mobile-list"
          mobileControls={(
            <div className="px-5 pb-2">
              <AutomationCommanderFilter
                commanders={commanders}
                value={commanderFilter}
                onChange={(value) => updateParams({ commander: value })}
                compact
                selectTestId="mobile-automation-commander-select"
              />
            </div>
          )}
          scope={
            commanderFilter === 'global' || !scopeCommander
              ? { kind: 'global' }
              : { kind: 'commander', commander: scopeCommander }
          }
          filter={triggerFilter}
          onFilterChange={(nextFilter) => {
            updateParams({
              trigger: nextFilter === 'all' ? null : nextFilter,
            })
          }}
          preselectedSkillName={preselectedSkillName}
          onPreselectedSkillConsumed={() => updateParams({ skill: null })}
        />
      </div>
    </section>
  )
}
