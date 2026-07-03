import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { discoverAgentSkillPackageDirs } from '../skills/skill-roots.js'

const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const CLAUDE_SKILLS_DIR = path.join(homedir(), '.claude', 'skills')

async function discoverAgentSkillPaths(): Promise<string[]> {
  return discoverAgentSkillPackageDirs()
}

async function getSkillSearchPaths(commanderSkillsDir?: string): Promise<string[]> {
  const paths: string[] = []

  if (commanderSkillsDir) {
    paths.push(commanderSkillsDir)
  }

  paths.push(CLAUDE_SKILLS_DIR)
  paths.push(...await discoverAgentSkillPaths())

  return paths
}

export function stripYamlFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) {
    return content.trim()
  }
  return content.slice(match[0].length).trim()
}

function normalizeSkillName(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || !SKILL_NAME_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

export function isValidSkillName(raw: string): boolean {
  return normalizeSkillName(raw) !== null
}

export async function resolveSkill(skillName: string, commanderSkillsDir?: string): Promise<string | null> {
  const normalized = normalizeSkillName(skillName)
  if (!normalized) {
    console.warn(`[automations] Invalid skill name: ${skillName}`)
    return null
  }

  const searchPaths = await getSkillSearchPaths(commanderSkillsDir)
  for (const basePath of searchPaths) {
    const skillPath = path.join(basePath, normalized, 'SKILL.md')
    try {
      await access(skillPath)
      const content = await readFile(skillPath, 'utf8')
      return stripYamlFrontmatter(content)
    } catch {
      // Continue to next search path.
    }
  }

  console.warn(`[automations] Skill not found: ${normalized}`)
  return null
}

export async function resolveSkills(skillNames: readonly string[], commanderSkillsDir?: string): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()

  for (const rawName of skillNames) {
    const name = normalizeSkillName(rawName)
    if (!name || resolved.has(name)) {
      continue
    }

    const content = await resolveSkill(name, commanderSkillsDir)
    if (content) {
      resolved.set(name, content)
    }
  }

  return resolved
}
