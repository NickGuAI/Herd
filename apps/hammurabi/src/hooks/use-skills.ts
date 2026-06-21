import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'

export interface Skill {
  name: string
  dirName?: string
  description: string
  userInvocable: boolean
  argumentHint?: string
  supportedProviders?: string[]
  source?: string
}

type SkillsResponse = Skill[] | { skills?: Skill[] }

function normalizeStringArray(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  const normalized = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

export async function fetchSkills(): Promise<Skill[]> {
  const payload = await fetchJson<SkillsResponse>('/api/skills')
  const skills = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.skills)
      ? payload.skills
      : []

  return skills
    .filter((skill) => skill.userInvocable === true)
    .map((skill) => ({
      ...skill,
      name: skill.name?.trim() || skill.dirName?.trim() || '',
      dirName: skill.dirName?.trim() || undefined,
      description: skill.description?.trim() || '',
      argumentHint: skill.argumentHint?.trim() || undefined,
      supportedProviders: normalizeStringArray(skill.supportedProviders),
      source: skill.source?.trim() || undefined,
    }))
    .filter((skill) => skill.name.length > 0)
}

export function useSkills() {
  return useQuery({
    queryKey: ['skills', 'user-invocable'],
    queryFn: fetchSkills,
    staleTime: 60_000,
  })
}
