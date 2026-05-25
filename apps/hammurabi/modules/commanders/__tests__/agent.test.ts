import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommanderAgent } from '../memory/prompt.js'
import type { PromptTask } from '../memory/prompt-task.js'

vi.setConfig({ testTimeout: 60_000 })

describe('CommanderAgent system prompt bootstrap', () => {
  let tmpDir: string
  let commanderId: string
  let memoryRoot: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'commander-agent-test-'))
    commanderId = '11111111-1111-4111-8111-111111111111'
    memoryRoot = join(tmpDir, commanderId, '.memory')
    await mkdir(memoryRoot, { recursive: true })
    await mkdir(join(memoryRoot, 'repos'), { recursive: true })
    await writeFile(join(memoryRoot, 'MEMORY.md'), '# Commander Memory\n\n- Prefer deterministic fixes.', 'utf-8')
    await mkdir(join(memoryRoot, 'backlog'), { recursive: true })
    await writeFile(join(memoryRoot, 'backlog', 'thin-index.md'), '- #77 Fix auth bug', 'utf-8')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('builds startup bootstrap with discovery pointers instead of memory bodies', async () => {
    const issue: PromptTask = {
      number: 77,
      title: 'Fix auth bug',
      body: 'Authentication fails during token refresh.',
      labels: [{ name: 'bug' }],
      owner: 'NickGuAI',
      repo: 'example-repo',
    }

    const agent = new CommanderAgent(commanderId, tmpDir)

    const taskPickup = await agent.buildTaskPickupSystemPrompt(
      'You are the commander system.',
      {
        currentTask: issue,
        recentConversation: [{ role: 'user', content: 'Please handle this quickly.' }],
        mode: 'startup',
      },
    )

    expect(taskPickup.systemPrompt).toContain('You are the commander system.')
    expect(taskPickup.systemPrompt).toContain('# Global Rules Bootstrap')
    expect(taskPickup.systemPrompt).toContain('~/.hammurabi/global-rules/USER.md')
    expect(taskPickup.systemPrompt).toContain('~/.hammurabi/global-rules/WORKSPACE.md')
    expect(taskPickup.systemPrompt).toContain('~/.hammurabi/global-rules/SKILLS_INDEX.md')
    expect(taskPickup.systemPrompt).toContain('# Shared Knowledge Bootstrap')
    expect(taskPickup.systemPrompt).toContain('~/.hammurabi/shared-knowledge/DOCTRINES.md')
    expect(taskPickup.systemPrompt).toContain('~/.hammurabi/shared-knowledge/COMMANDER_GUIDE.md')
    expect(taskPickup.systemPrompt).toContain('~/.hammurabi/shared-knowledge/LEARNINGS.md')
    expect(taskPickup.systemPrompt).toContain('# Hammurabi Quest Board')
    expect(taskPickup.systemPrompt).toContain(`hammurabi quests list --commander ${commanderId}`)
    expect(taskPickup.systemPrompt).not.toContain('\nhammurabi quests list\n')
    expect(taskPickup.systemPrompt).toContain('# Commander Memory Workflow')
    expect(taskPickup.systemPrompt).toContain('cat .memory/MEMORY.md')
    expect(taskPickup.systemPrompt).toContain('cat .memory/LONG_TERM_MEM.md')
    expect(taskPickup.systemPrompt).toContain(`hammurabi memory save --commander ${commanderId}`)
    expect(taskPickup.systemPrompt).toContain(`hammurabi memory --type=working_memory read --commander ${commanderId}`)
    expect(taskPickup.systemPrompt).toContain(`hammurabi memory --type=working_memory append --commander ${commanderId} "<scratch note>"`)
    expect(taskPickup.systemPrompt).toContain(`hammurabi commander transcripts search --commander ${commanderId} "<query>"`)
    expect(taskPickup.systemPrompt).not.toContain(`hammurabi memory find --commander ${commanderId}`)
    expect(taskPickup.systemPrompt).not.toContain(`hammurabi memory compact --commander ${commanderId}`)
    expect(taskPickup.systemPrompt).toContain('Leave memory cleanup/consolidation to the external cron + skill pipeline')
    expect(taskPickup.systemPrompt).toContain('## Commander Memory')
    expect(taskPickup.systemPrompt).toContain('### Progressive Memory Discovery')
    expect(taskPickup.systemPrompt).toContain('.memory/MEMORY.md')
    expect(taskPickup.systemPrompt).toContain('.memory/LONG_TERM_MEM.md')
    expect(taskPickup.systemPrompt).toContain('.memory/working-memory.md')
    expect(taskPickup.systemPrompt).not.toContain('Prefer deterministic fixes.')
    expect(taskPickup.systemPrompt).not.toContain('Please handle this quickly.')
    expect(taskPickup.memorySection).toBe(taskPickup.systemPromptSection)
    expect(taskPickup.memorySection).toContain('## Commander Memory')
    expect(taskPickup.memorySection).toContain('### Progressive Memory Discovery')
    expect(taskPickup.memorySection).not.toContain('You are the commander system.')
    expect(taskPickup.memorySection).not.toContain('# Global Rules Bootstrap')
    expect(taskPickup.memorySection).not.toContain('# Shared Knowledge Bootstrap')
    expect(taskPickup.memorySection).not.toContain('# Hammurabi Quest Board')
    expect(taskPickup.memorySection).not.toContain('# Commander Memory Workflow')
    expect(taskPickup.memorySection).not.toContain('Prefer deterministic fixes.')
    expect(taskPickup.layersIncluded).toContain(1)
    expect(taskPickup.layersIncluded).toContain(2)
  })

})
