import type {
  CreateSentinelInput,
  SentinelAgentType,
} from './sentinel-types'

export type SkillScheduleMode = 'daily' | 'weekly' | 'cron'

export interface SkillScheduleTarget {
  name: string
  dirName: string
  description?: string
  argumentHint?: string
}

export interface SkillScheduleCadenceInput {
  mode: SkillScheduleMode
  time: string
  weekday: string
  cronSchedule: string
}

export interface SelectedSkillScheduleInput extends SkillScheduleCadenceInput {
  name: string
  timezone: string
  instruction: string
  skillInput: string
  agentType: SentinelAgentType
  seedMemory?: string
  maxRuns?: number
}

export type SelectedSkillScheduleCreateInput = Omit<CreateSentinelInput, 'parentCommanderId'>

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const WEEKDAY_VALUES = new Set(['0', '1', '2', '3', '4', '5', '6'])

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'skill'
}

export function resolveSkillScheduleSkillName(skill: SkillScheduleTarget): string {
  const dirName = skill.dirName.trim()
  return dirName || skill.name.trim()
}

export function buildDefaultSelectedSkillScheduleName(skill: SkillScheduleTarget): string {
  return `${safeSlug(resolveSkillScheduleSkillName(skill))}-schedule`
}

export function buildDefaultSelectedSkillInstruction(skill: SkillScheduleTarget): string {
  return [
    `Run the /${skill.name} workflow for this scheduled automation.`,
    'Write a concise run report and include durable follow-up context in automation memory.',
  ].join('\n\n')
}

export function buildInstructionWithSkillInput(instruction: string, skillInput: string): string {
  const trimmedInstruction = instruction.trim()
  const trimmedInput = skillInput.trim()
  if (!trimmedInput) {
    return trimmedInstruction
  }
  return [
    trimmedInstruction,
    `Skill input:\n${trimmedInput}`,
  ].filter(Boolean).join('\n\n')
}

export function buildCronSchedule(input: SkillScheduleCadenceInput): string {
  if (input.mode === 'cron') {
    const schedule = input.cronSchedule.trim()
    if (!schedule) {
      throw new Error('Cron schedule is required.')
    }
    return schedule
  }

  const timeMatch = TIME_PATTERN.exec(input.time)
  if (!timeMatch) {
    throw new Error('Time must use HH:MM format.')
  }

  const hour = Number.parseInt(timeMatch[1] ?? '0', 10)
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10)

  if (input.mode === 'daily') {
    return `${minute} ${hour} * * *`
  }

  if (!WEEKDAY_VALUES.has(input.weekday)) {
    throw new Error('Choose a weekday.')
  }

  return `${minute} ${hour} * * ${input.weekday}`
}

export function buildSelectedSkillScheduleCreateInput(
  skill: SkillScheduleTarget,
  input: SelectedSkillScheduleInput,
): SelectedSkillScheduleCreateInput {
  const name = input.name.trim()
  const instruction = buildInstructionWithSkillInput(input.instruction, input.skillInput)
  const timezone = input.timezone.trim()
  const seedMemory = input.seedMemory?.trim() ?? ''

  if (!name) {
    throw new Error('Name is required.')
  }
  if (!instruction) {
    throw new Error('Instruction is required.')
  }

  return {
    name,
    schedule: buildCronSchedule(input),
    instruction,
    timezone,
    agentType: input.agentType,
    permissionMode: 'default',
    status: 'active',
    skills: [resolveSkillScheduleSkillName(skill)],
    ...(seedMemory ? { seedMemory } : {}),
    ...(input.maxRuns ? { maxRuns: input.maxRuns } : {}),
  }
}
