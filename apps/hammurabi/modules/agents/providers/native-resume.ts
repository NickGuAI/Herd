import type { AgentType, PersistedStreamSession, StreamSession } from '../types.js'
import type { ProviderAdapter } from './provider-adapter.js'
import type { ProviderSessionContext } from './provider-session-context.js'

interface NativeResumeProbeInput {
  provider: ProviderAdapter
  agentType: AgentType
  providerContext?: ProviderSessionContext
  sessionName: string
  cwd: string
}

function buildPersistedResumeProbe(input: NativeResumeProbeInput): PersistedStreamSession | null {
  if (!input.providerContext || input.providerContext.providerId !== input.agentType) {
    return null
  }

  return {
    name: input.sessionName,
    agentType: input.agentType,
    mode: 'default',
    cwd: input.cwd,
    createdAt: new Date(0).toISOString(),
    providerContext: input.providerContext,
  }
}

export function hasNativeProviderResumeIdentifier(input: NativeResumeProbeInput): boolean {
  const probe = buildPersistedResumeProbe(input)
  return probe ? input.provider.hasResumeIdentifier(probe) : false
}

export function resolveNativeProviderResumeId(input: NativeResumeProbeInput): string | undefined {
  const probe = buildPersistedResumeProbe(input)
  if (!probe || !input.provider.hasResumeIdentifier(probe)) {
    return undefined
  }

  return input.provider.getResumeId(probe as unknown as StreamSession)
}
