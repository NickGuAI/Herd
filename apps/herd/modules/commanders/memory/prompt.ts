import {
  MemoryContextBuilder,
  type BuiltContext,
  type ContextBuildOptions,
} from './context-builder.js'

export interface PriorConversationPointer {
  conversationId: string
  tail?: number
}

export interface CommanderAgentSystemPromptOptions extends ContextBuildOptions {
  priorConversation?: PriorConversationPointer
}

export function buildPriorConversationSection(pointer: PriorConversationPointer): string {
  const tail = pointer.tail ?? 40
  return `## Continuing Prior Conversation

This session continues conversation ${pointer.conversationId}. Earlier turns are not in your current context window.

To recall prior messages on demand, run:
  herd conversations messages ${pointer.conversationId} --tail ${tail}

Use that command whenever you need context from before this session start.`
}

function buildQuestBoardSection(commanderId: string): string {
  const commanderFlag = `--commander ${commanderId}`
  return `# Herd Quest Board

You are a Commander. Your work queue lives in the Herd quest board.
Use the \`herd\` CLI to manage it on every heartbeat.

## Commands

List your quests (check this on every heartbeat):
  herd quests list ${commanderFlag}

Claim a quest before starting work:
  herd quests claim <quest-id> ${commanderFlag}

Post a progress note mid-task:
  herd quests note <quest-id> ${commanderFlag} "what you found / what you're doing"

Mark done when complete:
  herd quests done <quest-id> ${commanderFlag} --note "what was done and where"

Mark failed if blocked:
  herd quests fail <quest-id> ${commanderFlag} --note "why it failed / what's needed"

## Rules
- Always claim before working. Never work an unclaimed quest.
- Post at least one note per quest before marking done.
- One active quest at a time unless explicitly told otherwise.`
}

function buildGlobalRulesBootstrapSection(): string {
  return `# Global Rules Bootstrap

The operator's durable global rules live outside the commander prompt. Load them when task scope, ambiguity, workspace routing, or skill selection depends on them.

## Files
- \`~/.herd/global-rules/USER.md\` — canonical user identity, focus, and ambiguity resolution. This wins over commander-local memory when they conflict.
- \`~/.herd/global-rules/WORKSPACE.md\` — workspace routing table. Read it before broad filesystem search.
- \`~/.herd/global-rules/SKILLS_INDEX.md\` — skill routing. Check it before inventing a procedure.

## Rules
- Discover and read only the files needed for the current task.
- Use the closest project guide after routing the workspace.
- Do not paste global rule bodies into memory; reference durable facts only when they matter to future work.`
}

function buildSharedKnowledgeBootstrapSection(): string {
  return `# Shared Knowledge Bootstrap

Shared commander knowledge lives on disk and should be discovered through exact reads when needed. These files are not memory payloads and should not be duplicated into commander memory.

## Files
- \`~/.herd/shared-knowledge/DOCTRINES.md\` — hard operational constraints and safety boundaries.
- \`~/.herd/shared-knowledge/COMMANDER_GUIDE.md\` — Herd CLI, worker, memory, quest-board, and operational procedures.
- \`~/.herd/shared-knowledge/LEARNINGS.md\` — curated reusable lessons.

## Rules
- Read \`DOCTRINES.md\` before changing behavior with operational or safety impact.
- Read \`COMMANDER_GUIDE.md\` before using unfamiliar Herd commands.
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
  herd memory --type=working_memory read ${commanderFlag}

## Write

Save durable facts after you discover them:
  herd memory save ${commanderFlag} "<fact>"

Keep transient scratch notes in working memory:
  herd memory --type=working_memory append ${commanderFlag} "<scratch note>"

## Transcript Search

Search indexed commander session transcripts when you need prior execution context:
  herd commander transcripts search ${commanderFlag} "<query>"

## Rules
- Read \`.memory/MEMORY.md\` and \`.memory/LONG_TERM_MEM.md\` before acting on prior decisions, paths, or constraints.
- Use working memory for transient task state, not durable conclusions.
- Save stable facts (decisions, paths, commands, constraints), not transient chatter.
- Transcript search is for indexed session output, not durable memory facts.
- Commander memory search/recollection is not a Herd runtime feature.
- Leave memory cleanup/consolidation to the external cron + skill pipeline.`
}

export interface CommanderAgentPromptResult extends BuiltContext {
  systemPrompt: string
  memorySection: string
}

/**
 * Prompt helper for Commander runtime events.
 * Builds the bounded Herd bootstrap appended to provider-native prompts.
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
    options: CommanderAgentSystemPromptOptions,
  ): Promise<CommanderAgentPromptResult> {
    return this.buildSystemPrompt(baseSystemPrompt, options)
  }

  private async buildSystemPrompt(
    baseSystemPrompt: string,
    options: CommanderAgentSystemPromptOptions,
  ): Promise<CommanderAgentPromptResult> {
    const builtContext = await this.contextBuilder.build(options)
    const base = baseSystemPrompt.trim()
    const promptSections = [
      base,
      base.includes('Global Rules Bootstrap') ? '' : buildGlobalRulesBootstrapSection(),
      base.includes('Shared Knowledge Bootstrap') ? '' : buildSharedKnowledgeBootstrapSection(),
      base.includes('Herd Quest Board') ? '' : buildQuestBoardSection(this.commanderId),
      base.includes('Commander Memory Workflow') ? '' : buildCommanderMemoryWorkflowSection(this.commanderId),
      options.priorConversation ? buildPriorConversationSection(options.priorConversation) : '',
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
