import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_SKILLS_DIR_ENV,
  DIRECT_SKILLS_DIRS_ENV,
  discoverAgentSkillPackageDirs,
  discoverSkillDirectorySources,
  resolveAgentSkillsDir,
} from '../skill-roots'

const tempRoots: string[] = []

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-skill-root-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('skill root discovery', () => {
  it('resolves bundled agent skills relative to the app package cwd', async () => {
    const repoRoot = await makeTempRoot()
    const appDir = path.join(repoRoot, 'apps', 'hammurabi')
    const skillsDir = path.join(repoRoot, 'agent-skills')
    await mkdir(path.join(skillsDir, 'general-skills'), { recursive: true })
    await mkdir(appDir, { recursive: true })

    await expect(resolveAgentSkillsDir(appDir, {})).resolves.toBe(skillsDir)
    await expect(discoverAgentSkillPackageDirs(appDir, {})).resolves.toEqual([
      path.join(skillsDir, 'general-skills'),
    ])
  })

  it('honors an explicit agent skills directory override', async () => {
    const root = await makeTempRoot()
    const skillsDir = path.join(root, 'custom-skills')
    await mkdir(path.join(skillsDir, 'pkos'), { recursive: true })

    await expect(resolveAgentSkillsDir('/missing/app', {
      [AGENT_SKILLS_DIR_ENV]: skillsDir,
    })).resolves.toBe(skillsDir)
  })

  it('discovers direct installed skill roots before bundled package roots', async () => {
    const root = await makeTempRoot()
    const directSkillsDir = path.join(root, 'direct-skills')
    const agentSkillsDir = path.join(root, 'agent-skills')
    const packageDir = path.join(agentSkillsDir, 'general-skills')
    await mkdir(directSkillsDir, { recursive: true })
    await mkdir(packageDir, { recursive: true })

    const sources = await discoverSkillDirectorySources('/missing/app', {
      [DIRECT_SKILLS_DIRS_ENV]: directSkillsDir,
      [AGENT_SKILLS_DIR_ENV]: agentSkillsDir,
    })
    const directIndex = sources.findIndex((entry) => entry.dir === directSkillsDir)
    const packageIndex = sources.findIndex((entry) => entry.dir === packageDir)

    expect(directIndex).toBeGreaterThanOrEqual(0)
    expect(packageIndex).toBeGreaterThanOrEqual(0)
    expect(directIndex).toBeLessThan(packageIndex)
    expect(sources[directIndex]).toMatchObject({
      dir: directSkillsDir,
      source: 'direct-skills',
    })
    expect(sources[packageIndex]).toMatchObject({
      dir: packageDir,
      source: 'general-skills',
    })
  })
})
