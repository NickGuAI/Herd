import type {
  CommanderCurrentTask,
  CommanderTaskSource,
} from '../store.js'
import {
  resolveCommanderWorkflow,
  resolveEffectiveBasePrompt,
  type ResolvedCommanderWorkflow,
} from '../workflow-resolution.js'
import { CommanderAgent } from './prompt.js'
import type { PromptTask } from './prompt-task.js'

export interface CommanderSessionSeedParams {
  commanderId: string
  cwd?: string
  currentTask: CommanderCurrentTask | null
  taskSource: CommanderTaskSource | null
  maxTurns: number
  memoryBasePath?: string
}

function toPromptTaskFromTaskContext(
  currentTask: CommanderCurrentTask | null,
  taskSource: CommanderTaskSource | null,
): PromptTask | null {
  if (!currentTask || !taskSource) {
    return null
  }

  const labels = taskSource.label ? [{ name: taskSource.label }] : undefined
  return {
    number: currentTask.issueNumber,
    title: `Issue #${currentTask.issueNumber}`,
    body: '',
    labels,
    owner: taskSource.owner,
    repo: taskSource.repo,
    repository: `${taskSource.owner}/${taskSource.repo}`,
  }
}

export async function buildCommanderSessionSeedFromResolvedWorkflow(
  params: CommanderSessionSeedParams,
  resolvedWorkflow: ResolvedCommanderWorkflow,
): Promise<{ systemPrompt: string; maxTurns?: number }> {
  const basePrompt = resolveEffectiveBasePrompt(resolvedWorkflow.workflow).trim()
  const agent = new CommanderAgent(params.commanderId, params.memoryBasePath)
  const built = await agent.buildTaskPickupSystemPrompt(
    basePrompt,
    {
      currentTask: toPromptTaskFromTaskContext(params.currentTask, params.taskSource),
      recentConversation: [],
      mode: 'startup',
    },
  )

  return {
    systemPrompt: built.systemPrompt,
    maxTurns: params.maxTurns,
  }
}

export async function buildCommanderSessionSeed(
  params: CommanderSessionSeedParams,
): Promise<{ systemPrompt: string; maxTurns?: number }> {
  const resolvedWorkflow = await resolveCommanderWorkflow(
    params.commanderId,
    params.cwd,
    params.memoryBasePath,
  )
  return buildCommanderSessionSeedFromResolvedWorkflow(params, resolvedWorkflow)
}
