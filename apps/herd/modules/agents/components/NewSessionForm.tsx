import { memo, type FormEvent, type ReactNode } from 'react'
import type {
  AgentSession,
  AgentType,
  Machine,
  SessionTransportType,
} from '@/types'
import { useProviderRegistry } from '@/hooks/use-providers'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { AgentEffortLevel } from '../effort.js'
import type { ClaudeMaxThinkingTokens } from '../../claude-max-thinking-tokens.js'
import { AgentControlsSection } from './new-session-form/AgentControlsSection'
import { MachineSection } from './new-session-form/MachineSection'
import { ResumeSourceSection } from './new-session-form/ResumeSourceSection'
import { SessionFieldsSection } from './new-session-form/SessionFieldsSection'
import { useNewSessionConstraints } from './new-session-form/useNewSessionConstraints'

const NOOP_SET_STRING = (_value: string): undefined => undefined

export interface NewSessionFormProps {
  name?: string
  setName?: (value: string) => void
  cwd: string
  setCwd: (value: string) => void
  task: string
  setTask: (value: string) => void
  effort: AgentEffortLevel
  setEffort: (value: AgentEffortLevel) => void
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  setAdaptiveThinking: (value: ClaudeAdaptiveThinkingMode) => void
  maxThinkingTokens: ClaudeMaxThinkingTokens
  setMaxThinkingTokens: (value: ClaudeMaxThinkingTokens) => void
  agentType: AgentType
  setAgentType: (value: AgentType) => void
  model?: string | null
  transportType: Exclude<SessionTransportType, 'external'>
  setTransportType: (value: Exclude<SessionTransportType, 'external'>) => void
  machines: Machine[]
  selectedMachineId: string
  setSelectedMachineId: (value: string) => void
  isCreating: boolean
  createError: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  resumeOptions?: AgentSession[]
  resumeSourceName?: string
  setResumeSourceName?: (value: string) => void
  resumeSource?: AgentSession | null
  schedule?: string
  setSchedule?: (value: string) => void
  submitLabel?: string
  submitDisabled?: boolean
  nameLabel?: string
  namePlaceholder?: string
  namePattern?: string
  taskLabel?: string
  taskPlaceholder?: string
  taskRequired?: boolean
  beforeTaskField?: ReactNode
  afterScheduleField?: ReactNode
  showNameField?: boolean
  agentOptions?: readonly AgentType[]
}

function NewSessionFormComponent({
  name = '',
  setName = NOOP_SET_STRING,
  cwd,
  setCwd,
  task,
  setTask,
  effort,
  setEffort,
  adaptiveThinking,
  setAdaptiveThinking,
  maxThinkingTokens,
  setMaxThinkingTokens,
  agentType,
  setAgentType,
  model,
  transportType,
  setTransportType,
  machines,
  selectedMachineId,
  setSelectedMachineId,
  isCreating,
  createError,
  onSubmit,
  resumeOptions,
  resumeSourceName = '',
  setResumeSourceName,
  resumeSource = null,
  schedule,
  setSchedule,
  submitLabel = 'Start Session',
  submitDisabled = false,
  nameLabel = 'Session Name',
  namePlaceholder = 'agent-fix-auth',
  namePattern = '[a-zA-Z0-9_\\-]+',
  taskLabel = 'Initial Task (Optional)',
  taskPlaceholder = 'Fix the auth bug in login.ts',
  taskRequired = false,
  beforeTaskField,
  afterScheduleField,
  showNameField = true,
  agentOptions,
}: NewSessionFormProps) {
  const { data: registeredProviders = [] } = useProviderRegistry()
  const showMachineSelector = machines.length > 0
  const resumeSelectionEnabled = Array.isArray(resumeOptions) && typeof setResumeSourceName === 'function'
  const resumeLocked = resumeSource !== null
  const providers = registeredProviders.filter((provider) =>
    !agentOptions || agentOptions.includes(provider.id),
  )
  const currentProvider = providers.find((provider) => provider.id === agentType) ?? null
  const effectiveModel = model ?? resumeSource?.model ?? currentProvider?.defaults?.model ?? null
  const providerReady = providers.some((provider) => provider.id === agentType)

  useNewSessionConstraints({
    providers,
    agentType,
    model: effectiveModel,
    setAgentType,
    transportType,
    setTransportType,
    effort,
    setEffort,
    adaptiveThinking,
    setAdaptiveThinking,
    maxThinkingTokens,
    setMaxThinkingTokens,
  })

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <AgentControlsSection
        providers={providers}
        agentType={agentType}
        setAgentType={setAgentType}
        transportType={transportType}
        setTransportType={setTransportType}
        resumeLocked={resumeLocked}
        model={effectiveModel}
        effort={effort}
        setEffort={setEffort}
        adaptiveThinking={adaptiveThinking}
        setAdaptiveThinking={setAdaptiveThinking}
        maxThinkingTokens={maxThinkingTokens}
        setMaxThinkingTokens={setMaxThinkingTokens}
      />

      {resumeSelectionEnabled ? (
        <ResumeSourceSection
          resumeSourceName={resumeSourceName}
          setResumeSourceName={setResumeSourceName}
          resumeOptions={resumeOptions}
          resumeSource={resumeSource}
          machines={machines}
        />
      ) : null}

      {showMachineSelector ? (
        <MachineSection
          selectedMachineId={selectedMachineId}
          setSelectedMachineId={setSelectedMachineId}
          machines={machines}
          resumeLocked={resumeLocked}
          resumeSource={resumeSource}
        />
      ) : null}

      <SessionFieldsSection
        name={name}
        setName={setName}
        showNameField={showNameField}
        nameLabel={nameLabel}
        namePlaceholder={namePlaceholder}
        namePattern={namePattern}
        schedule={schedule}
        setSchedule={setSchedule}
        afterScheduleField={afterScheduleField}
        cwd={cwd}
        setCwd={setCwd}
        selectedMachineId={selectedMachineId}
        resumeLocked={resumeLocked}
        taskLabel={taskLabel}
        task={task}
        setTask={setTask}
        taskPlaceholder={taskPlaceholder}
        taskRequired={taskRequired}
        beforeTaskField={beforeTaskField}
        createError={createError}
        isCreating={isCreating}
        submitDisabled={submitDisabled || !providerReady}
        submitLabel={submitLabel}
      />
    </form>
  )
}

export const NewSessionForm = memo(NewSessionFormComponent)
NewSessionForm.displayName = 'NewSessionForm'
