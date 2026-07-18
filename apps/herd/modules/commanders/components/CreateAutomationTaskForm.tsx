import { type FormEvent, useEffect, useState } from 'react'
import {
  findProviderEntry,
  getProviderControlDefaults,
  resolveDefaultProviderId,
  useProviderRegistry,
} from '@/hooks/use-providers'
import { useSkills } from '@/hooks/use-skills'
import type { AgentType, Machine, SessionTransportType } from '@/types'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { AgentEffortLevel } from '../../agents/effort.js'
import type { ClaudeMaxThinkingTokens } from '../../claude-max-thinking-tokens.js'
import type { CreateAutomationTaskInput } from '../../automations/hooks/useAutomations'
import { detectBrowserTimezone, TIMEZONE_OPTIONS } from '../../automations/timezones'
import { NewSessionForm } from '../../agents/components/NewSessionForm'
import { ProviderModelSelect, resolveProviderModelOptions } from './ProviderModelSelect'

function prependSkillInvocation(instruction: string, skillName: string): string {
  const command = `/${skillName}`
  const trimmed = instruction.trim()
  if (trimmed === command || trimmed.startsWith(`${command} `)) {
    return trimmed
  }
  if (trimmed.length === 0) {
    return `${command} `
  }
  return `${command} ${trimmed}`
}

interface CreateAutomationTaskFormProps {
  onCreate: (input: CreateAutomationTaskInput) => Promise<unknown>
  onClose: () => void
  machines: Machine[]
  createPending: boolean
}

export function CreateAutomationTaskForm({
  onCreate,
  onClose,
  machines,
  createPending,
}: CreateAutomationTaskFormProps) {
  const {
    data: skills,
    error: skillsError,
    isError: skillsIsError,
    isLoading: skillsLoading,
    refetch: refetchSkills,
  } = useSkills()
  const { data: providers = [], automationDefaultProviderId } = useProviderRegistry()
  const skillList = skills ?? []
  const initialProviderControls = getProviderControlDefaults(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schedule, setSchedule] = useState('')
  const [cwd, setCwd] = useState('')
  const [task, setTask] = useState('')
  const [timezone, setTimezone] = useState(() => detectBrowserTimezone())
  const [agentType, setAgentType] = useState<AgentType>('')
  const [transportType, setTransportType] =
    useState<Exclude<SessionTransportType, 'external'>>(initialProviderControls.transportType)
  const [effort, setEffort] = useState<AgentEffortLevel>(initialProviderControls.effort)
  const [adaptiveThinking, setAdaptiveThinking] = useState<ClaudeAdaptiveThinkingMode>(
    initialProviderControls.adaptiveThinking,
  )
  const [maxThinkingTokens, setMaxThinkingTokens] = useState<ClaudeMaxThinkingTokens>(
    initialProviderControls.maxThinkingTokens,
  )
  const [model, setModel] = useState<string | null>(null)
  const [selectedHost, setSelectedHost] = useState('')
  const [selectedSkill, setSelectedSkill] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const activeSkill = skillList.find((s) => s.name === selectedSkill) ?? null
  const defaultAgentType = resolveDefaultProviderId(providers, automationDefaultProviderId)
  const currentProvider = findProviderEntry(providers, agentType)
  const availableModels = resolveProviderModelOptions(providers, agentType)

  useEffect(() => {
    if (defaultAgentType && !currentProvider) {
      setAgentType(defaultAgentType)
    }
  }, [currentProvider, defaultAgentType])

  useEffect(() => {
    if (!currentProvider) {
      return
    }
    const defaults = getProviderControlDefaults(currentProvider)
    setTransportType(defaults.transportType)
    setEffort(defaults.effort)
    setAdaptiveThinking(defaults.adaptiveThinking)
    setMaxThinkingTokens(defaults.maxThinkingTokens)
  }, [currentProvider])

  useEffect(() => {
    if (model && !availableModels.some((option) => option.id === model)) {
      setModel(null)
    }
  }, [availableModels, model])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError(null)
    try {
      if (!currentProvider) {
        throw new Error('Select an available provider before creating an automation.')
      }
      const createInput: CreateAutomationTaskInput = {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        schedule: schedule.trim(),
        timezone: timezone.trim() || undefined,
        machine: selectedHost,
        workDir: cwd.trim(),
        agentType: agentType as CreateAutomationTaskInput['agentType'],
        instruction: task.trim(),
        ...(model ? { model } : {}),
        enabled: true,
        permissionMode: 'default',
        sessionType: transportType,
      }
      await onCreate(createInput)
      setName('')
      setDescription('')
      setSchedule('')
      setTimezone(detectBrowserTimezone())
      setCwd('')
      setTask('')
      if (defaultAgentType) {
        setAgentType(defaultAgentType)
      }
      const defaults = getProviderControlDefaults(currentProvider)
      setTransportType(defaults.transportType)
      setEffort(defaults.effort)
      setAdaptiveThinking(defaults.adaptiveThinking)
      setMaxThinkingTokens(defaults.maxThinkingTokens)
      setModel(null)
      setSelectedHost('')
      setSelectedSkill('')
      onClose()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create task')
    }
  }

  return (
    <div>
      <NewSessionForm
        name={name}
        setName={setName}
        cwd={cwd}
        setCwd={setCwd}
        task={task}
        setTask={setTask}
        effort={effort}
        setEffort={setEffort}
        adaptiveThinking={adaptiveThinking}
        setAdaptiveThinking={setAdaptiveThinking}
        maxThinkingTokens={maxThinkingTokens}
        setMaxThinkingTokens={setMaxThinkingTokens}
        agentType={agentType}
        setAgentType={setAgentType}
        model={model}
        transportType={transportType}
        setTransportType={setTransportType}
        machines={machines}
        selectedMachineId={selectedHost}
        setSelectedMachineId={setSelectedHost}
        isCreating={createPending}
        createError={createError}
        onSubmit={(e) => void handleSubmit(e)}
        schedule={schedule}
        setSchedule={setSchedule}
        submitLabel="Create Automation"
        nameLabel="Automation Name"
        namePlaceholder="nightly-deploy"
        namePattern=""
        taskLabel="Instruction"
        taskPlaceholder="Run the nightly test suite and report results"
        taskRequired
        beforeTaskField={
          <div className="space-y-3">
            <div>
              <label className="section-title block mb-2">Description (Optional)</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full min-h-20 px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
                placeholder="Describe what this automation does"
              />
            </div>
            {currentProvider?.uiCapabilities.supportsSkills ? (
              <div>
                <label className="section-title block mb-2">Skill (Optional)</label>
                <select
                  value={selectedSkill}
                  onChange={(event) => {
                    const skillName = event.target.value
                    setSelectedSkill(skillName)
                    if (skillName) {
                      setTask((current) => prependSkillInvocation(current, skillName))
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
                  disabled={skillsIsError}
                >
                  <option value="">
                    {skillsLoading
                      ? 'Loading skills...'
                      : skillsIsError
                        ? 'Unable to load skills'
                      : skillList.length > 0
                        ? '— Select a skill —'
                        : 'No user-invocable skills installed'}
                  </option>
                  {skillList.map((skill) => (
                    <option key={skill.name} value={skill.name}>
                      /{skill.name}
                    </option>
                  ))}
                </select>
                {skillsIsError ? (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                    <p>{skillsError instanceof Error ? skillsError.message : 'Unable to load skills.'}</p>
                    <button
                      type="button"
                      className="mt-1 font-mono text-xs underline"
                      onClick={() => {
                        void refetchSkills()
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : activeSkill ? (
                  <div className="mt-2 rounded-lg border border-ink-border bg-washi-aged/60 px-3 py-2.5 space-y-1.5">
                    <p className="text-sm text-sumi-gray">{activeSkill.description}</p>
                    {activeSkill.argumentHint ? (
                      <p className="font-mono text-xs text-sumi-diluted">
                        Usage: /{activeSkill.name} {activeSkill.argumentHint}
                      </p>
                    ) : (
                      <p className="text-xs text-sumi-mist">No parameters required.</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-whisper text-sumi-mist">
                    Select a skill to see its parameters and prepend it to the instruction.
                  </p>
                )}
              </div>
            ) : null}
            <div>
              <ProviderModelSelect
                providers={providers}
                agentType={agentType}
                value={model}
                onChange={setModel}
                className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
              />
            </div>
          </div>
        }
      />
      <div className="mt-3">
        <label className="section-title block mb-2">Timezone</label>
        {TIMEZONE_OPTIONS.length > 0 ? (
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
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
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged font-mono text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
            placeholder="America/Los_Angeles"
          />
        )}
        <p className="mt-1 text-whisper text-sumi-mist">Defaults to your browser timezone</p>
      </div>
    </div>
  )
}
