import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Plus } from 'lucide-react'
import { resolveDefaultProviderId, useProviderRegistry } from '@/hooks/use-providers'
import type { AgentType } from '@/types'
import { ModalFormContainer } from '../../components/ModalFormContainer'
import { ScheduleExpressionField } from '../../components/ScheduleExpressionField'
import { useAutomations } from '../hooks/useAutomations'
import {
  buildDefaultSelectedSkillInstruction,
  buildDefaultSelectedSkillScheduleName,
  buildSelectedSkillScheduleCreateInput,
  type SkillScheduleMode,
  type SkillScheduleTarget,
} from '../skill-schedule'
import { detectBrowserTimezone, TIMEZONE_OPTIONS } from '../timezones'

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const

function scheduleModeClassName(active: boolean): string {
  return [
    'inline-flex min-h-10 flex-1 items-center justify-center rounded-md border px-3 py-2 text-sm transition-colors',
    active
      ? 'border-sumi-black bg-sumi-black text-washi-white'
      : 'border-ink-border bg-washi-aged text-sumi-diluted hover:border-ink-border-hover hover:text-sumi-black',
  ].join(' ')
}

interface SelectedSkillScheduleFormProps {
  skill: SkillScheduleTarget
  isSubmitting: boolean
  error: string | null
  onSubmit: (input: ReturnType<typeof buildSelectedSkillScheduleCreateInput>) => Promise<unknown>
  onCancel: () => void
}

function SelectedSkillScheduleForm({
  skill,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: SelectedSkillScheduleFormProps) {
  const { data: providers = [], automationDefaultProviderId } = useProviderRegistry()
  const automationProviders = useMemo(
    () => providers.filter((provider) => provider.capabilities.supportsAutomation),
    [providers],
  )
  const defaultAgentType = resolveDefaultProviderId(
    providers,
    automationDefaultProviderId,
    { predicate: (provider) => provider.capabilities.supportsAutomation },
  )
  const [name, setName] = useState(() => buildDefaultSelectedSkillScheduleName(skill))
  const [mode, setMode] = useState<SkillScheduleMode>('daily')
  const [time, setTime] = useState('09:00')
  const [weekday, setWeekday] = useState('1')
  const [cronSchedule, setCronSchedule] = useState('0 9 * * *')
  const [timezone, setTimezone] = useState(() => detectBrowserTimezone())
  const [skillInput, setSkillInput] = useState('')
  const [instruction, setInstruction] = useState(() => buildDefaultSelectedSkillInstruction(skill))
  const [seedMemory, setSeedMemory] = useState('')
  const [maxRuns, setMaxRuns] = useState('')
  const [agentType, setAgentType] = useState<AgentType | ''>(() => defaultAgentType ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!agentType && defaultAgentType) {
      setAgentType(defaultAgentType)
      return
    }
    if (
      agentType
      && automationProviders.length > 0
      && !automationProviders.some((provider) => provider.id === agentType)
    ) {
      setAgentType(defaultAgentType ?? '')
    }
  }, [agentType, automationProviders, defaultAgentType])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const parsedMaxRuns = maxRuns.trim().length > 0
      ? Number.parseInt(maxRuns.trim(), 10)
      : undefined
    if (!agentType) {
      setFormError('Select an automation-capable provider.')
      return
    }
    if (parsedMaxRuns !== undefined && (!Number.isInteger(parsedMaxRuns) || parsedMaxRuns <= 0)) {
      setFormError('Max runs must be a positive integer.')
      return
    }

    try {
      setFormError(null)
      await onSubmit(buildSelectedSkillScheduleCreateInput(skill, {
        name,
        mode,
        time,
        weekday,
        cronSchedule,
        timezone,
        skillInput,
        instruction,
        agentType,
        seedMemory,
        ...(parsedMaxRuns ? { maxRuns: parsedMaxRuns } : {}),
      }))
      onCancel()
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to create schedule.')
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      <section
        data-testid="skill-schedule-selected-skill"
        className="rounded-lg border border-ink-border bg-washi-aged/50 px-4 py-3"
      >
        <p className="section-title">Selected skill</p>
        <p className="mt-2 font-mono text-sm text-sumi-black">/{skill.name}</p>
        {skill.description ? (
          <p className="mt-1 text-sm text-sumi-diluted">{skill.description}</p>
        ) : null}
      </section>

      <div>
        <label className="section-title mb-2 block" htmlFor="skill-schedule-name">
          Name
        </label>
        <input
          id="skill-schedule-name"
          data-testid="skill-schedule-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
          required
          pattern="[a-zA-Z0-9_\-]+"
          title="Alphanumeric, underscore, and hyphen only"
        />
      </div>

      <div>
        <p className="section-title mb-2">Cadence</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Schedule cadence">
          {(['daily', 'weekly', 'cron'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`skill-schedule-mode-${option}`}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={scheduleModeClassName(mode === option)}
            >
              {option === 'cron' ? 'Cron' : option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {mode === 'cron' ? (
        <ScheduleExpressionField
          schedule={cronSchedule}
          onScheduleChange={setCronSchedule}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'weekly' ? (
            <label className="block">
              <span className="section-title mb-2 block">Day</span>
              <select
                data-testid="skill-schedule-weekday"
                value={weekday}
                onChange={(event) => setWeekday(event.target.value)}
                className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="section-title mb-2 block">Time</span>
            <input
              data-testid="skill-schedule-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 font-mono text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
              required
            />
          </label>
        </div>
      )}

      <label className="block">
        <span className="section-title mb-2 block">Timezone</span>
        {TIMEZONE_OPTIONS.length > 0 ? (
          <select
            data-testid="skill-schedule-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
          >
            {!TIMEZONE_OPTIONS.includes(timezone) && timezone ? (
              <option value={timezone}>{timezone}</option>
            ) : null}
            <option value="">Server default</option>
            {TIMEZONE_OPTIONS.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid="skill-schedule-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 font-mono text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
            placeholder="America/New_York"
          />
        )}
      </label>

      <div>
        <label className="section-title mb-2 block" htmlFor="skill-schedule-input">
          Skill input
        </label>
        <textarea
          id="skill-schedule-input"
          data-testid="skill-schedule-input"
          value={skillInput}
          onChange={(event) => setSkillInput(event.target.value)}
          className="min-h-20 w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
          placeholder={skill.argumentHint ?? 'Input for this scheduled run.'}
        />
        {skill.argumentHint ? (
          <p className="mt-1 text-whisper text-sumi-mist">{skill.argumentHint}</p>
        ) : null}
      </div>

      <div>
        <label className="section-title mb-2 block" htmlFor="skill-schedule-instruction">
          Instruction
        </label>
        <textarea
          id="skill-schedule-instruction"
          data-testid="skill-schedule-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          className="min-h-28 w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="section-title mb-2 block">Provider</span>
          <select
            data-testid="skill-schedule-agent-type"
            value={agentType}
            onChange={(event) => setAgentType(event.target.value as AgentType)}
            className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
            required
          >
            {automationProviders.length === 0 ? (
              <option value="">No automation providers</option>
            ) : null}
            {automationProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="section-title mb-2 block">Max runs</span>
          <input
            type="number"
            min={1}
            step={1}
            value={maxRuns}
            onChange={(event) => setMaxRuns(event.target.value)}
            className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 font-mono text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
            placeholder="Optional"
          />
        </label>
      </div>

      <div>
        <label className="section-title mb-2 block" htmlFor="skill-schedule-seed-memory">
          Seed memory
        </label>
        <textarea
          id="skill-schedule-seed-memory"
          value={seedMemory}
          onChange={(event) => setSeedMemory(event.target.value)}
          className="min-h-20 w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm"
          placeholder="Context this scheduled skill should remember across runs."
        />
      </div>

      {(formError || error) ? (
        <div className="flex items-start gap-2 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{formError ?? error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-diluted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg border border-sumi-black bg-sumi-black px-4 py-2 text-sm text-washi-white disabled:opacity-60"
        >
          <Plus size={14} />
          {isSubmitting ? 'Creating...' : 'Create schedule'}
        </button>
      </div>
    </form>
  )
}

export function SelectedSkillScheduleDialog({
  skill,
  onClose,
}: {
  skill: SkillScheduleTarget
  onClose: () => void
}) {
  const automationState = useAutomations({ kind: 'global' })

  return (
    <ModalFormContainer
      open
      title="Schedule skill"
      onClose={onClose}
      desktopClassName="max-w-2xl"
    >
      <div className="mb-2 flex items-center gap-2 text-sm text-sumi-diluted">
        <CalendarClock size={15} />
        <span>Selected skill schedule</span>
      </div>
      <SelectedSkillScheduleForm
        skill={skill}
        isSubmitting={automationState.createSentinelPending}
        error={automationState.actionError}
        onSubmit={automationState.createSentinel}
        onCancel={onClose}
      />
    </ModalFormContainer>
  )
}
