import {
  MemoryContextBuilder,
  type BuiltContext,
  type ContextBuildOptions,
} from './context-builder.js'

function buildQuestBoardSection(commanderId: string): string {
  const commanderFlag = `--commander ${commanderId}`
  return `# Hammurabi Quest Board

You are a Commander. Your work queue lives in the Hammurabi quest board.
Use the \`hammurabi\` CLI to manage it on every heartbeat.

## Commands

List your quests (check this on every heartbeat):
  hammurabi quests list ${commanderFlag}

Claim a quest before starting work:
  hammurabi quests claim <quest-id> ${commanderFlag}

Post a progress note mid-task:
  hammurabi quests note <quest-id> ${commanderFlag} "what you found / what you're doing"

Mark done when complete:
  hammurabi quests done <quest-id> ${commanderFlag} --note "what was done and where"

Mark failed if blocked:
  hammurabi quests fail <quest-id> ${commanderFlag} --note "why it failed / what's needed"

## Rules
- Always claim before working. Never work an unclaimed quest.
- Post at least one note per quest before marking done.
- One active quest at a time unless explicitly told otherwise.`
}

function buildGlobalRulesBootstrapSection(): string {
  return `# Global Rules Bootstrap

The operator's durable global rules live outside the commander prompt. Load them when task scope, ambiguity, workspace routing, or skill selection depends on them.

## Files
- \`~/.hammurabi/global-rules/USER.md\` — canonical user identity, focus, and ambiguity resolution. This wins over commander-local memory when they conflict.
- \`~/.hammurabi/global-rules/WORKSPACE.md\` — workspace routing table. Read it before broad filesystem search.
- \`~/.hammurabi/global-rules/SKILLS_INDEX.md\` — skill routing. Check it before inventing a procedure.

## Rules
- Discover and read only the files needed for the current task.
- Use the closest project guide after routing the workspace.
- Do not paste global rule bodies into memory; reference durable facts only when they matter to future work.`
}

function buildSharedKnowledgeBootstrapSection(): string {
  return `# Shared Knowledge Bootstrap

Shared commander knowledge lives on disk and should be discovered through exact reads when needed. These files are not memory payloads and should not be duplicated into commander memory.

## Files
- \`~/.hammurabi/shared-knowledge/DOCTRINES.md\` — hard operational constraints and safety boundaries.
- \`~/.hammurabi/shared-knowledge/COMMANDER_GUIDE.md\` — Hammurabi CLI, worker, memory, quest-board, and operational procedures.
- \`~/.hammurabi/shared-knowledge/LEARNINGS.md\` — curated reusable lessons.

## Rules
- Read \`DOCTRINES.md\` before changing behavior with operational or safety impact.
- Read \`COMMANDER_GUIDE.md\` before using unfamiliar Hammurabi commands.
- Promote only reusable, verified lessons back into shared knowledge.`
}

function buildCommanderMemoryWorkflowSection(commanderId: string): string {
  const commanderFlag = `--commander ${commanderId}`
  return `# Commander Memory Workflow

Use progressive memory discovery during every task and heartbeat.
Memory file contents are not injected into the startup prompt. Read the files or search transcripts only when the current task needs prior facts, decisions, paths, or working state.

## Read

Read durable memory files directly when you need prior context:
  cat .memory/MEMORY.md
  cat .memory/LONG_TERM_MEM.md

Read active scratch state when resuming work:
  hammurabi memory --type=working_memory read ${commanderFlag}

## Write

Save durable facts after you discover them:
  hammurabi memory save ${commanderFlag} "<fact>"

Keep transient scratch notes in working memory:
  hammurabi memory --type=working_memory append ${commanderFlag} "<scratch note>"

## Transcript Search

Search indexed commander session transcripts when you need prior execution context:
  hammurabi commander transcripts search ${commanderFlag} "<query>"

## Rules
- Read \`.memory/MEMORY.md\` and \`.memory/LONG_TERM_MEM.md\` before acting on prior decisions, paths, or constraints.
- Use working memory for transient task state, not durable conclusions.
- Save stable facts (decisions, paths, commands, constraints), not transient chatter.
- Transcript search is for indexed session output, not durable memory facts.
- Commander memory search/recollection is not a Hammurabi runtime feature.
- Leave memory cleanup/consolidation to the external cron + skill pipeline.`
}

export interface CommanderAgentPromptResult extends BuiltContext {
  systemPrompt: string
  memorySection: string
}

/**
 * Prompt helper for Commander runtime events.
 * Builds the bounded Hammurabi bootstrap appended to provider-native prompts.
 */
export class CommanderAgent {
  private readonly contextBuilder: MemoryContextBuilder

  constructor(
    private readonly commanderId: string,
    basePath?: string,
  ) {
    this.contextBuilder = new MemoryContextBuilder(commanderId, basePath)
  }

  async buildTaskPickupSystemPrompt(
    baseSystemPrompt: string,
    options: ContextBuildOptions,
  ): Promise<CommanderAgentPromptResult> {
    return this.buildSystemPrompt(baseSystemPrompt, options)
  }

  private async buildSystemPrompt(
    baseSystemPrompt: string,
    options: ContextBuildOptions,
  ): Promise<CommanderAgentPromptResult> {
    const builtContext = await this.contextBuilder.build(options)
    const base = baseSystemPrompt.trim()
    const promptSections = [
      base,
      base.includes('Global Rules Bootstrap') ? '' : buildGlobalRulesBootstrapSection(),
      base.includes('Shared Knowledge Bootstrap') ? '' : buildSharedKnowledgeBootstrapSection(),
      base.includes('Hammurabi Quest Board') ? '' : buildQuestBoardSection(this.commanderId),
      base.includes('Commander Memory Workflow') ? '' : buildCommanderMemoryWorkflowSection(this.commanderId),
      builtContext.systemPromptSection,
    ].filter((section) => section.length > 0)
    const systemPrompt = promptSections.join('\n\n')

    return {
      ...builtContext,
      systemPrompt,
      memorySection: builtContext.systemPromptSection,
    }
  }

  get id(): string {
    return this.commanderId
  }
}
