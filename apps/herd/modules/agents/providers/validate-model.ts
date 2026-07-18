import { getProvider } from './registry.js'
import {
  getCachedProviderModelsForValidation,
  resolveProviderModels,
  type ResolveProviderModelsOptions,
} from './model-discovery.js'
import type {
  ProviderAdapter,
  ProviderModelDiscoveryContext,
  ProviderModelOption,
} from './provider-adapter.js'

export type ModelValidationResult =
  | { ok: true }
  | { ok: false; error: string; validIds: string[] }

export function findProviderModelOption(
  models: readonly ProviderModelOption[],
  model: string | null | undefined,
): ProviderModelOption | undefined {
  const id = model?.trim()
  if (!id) {
    return models.find((entry) => entry.default) ?? models[0]
  }
  return models.find((entry) => (
    entry.id === id
    || entry.resolvedModel === id
    || entry.aliases?.includes(id) === true
  ))
}

function validateResolvedModel(
  agentType: string,
  model: string | null,
  provider: ProviderAdapter | undefined,
  models: readonly ProviderModelOption[],
): ModelValidationResult {
  const trimmedModel = typeof model === 'string' ? model.trim() : ''
  if (!trimmedModel) {
    return { ok: true }
  }

  const validIds = models.map((entry) => entry.id)
  const acceptedIds = new Set(models.flatMap((entry) => [entry.id, ...(entry.aliases ?? [])]))
  if (acceptedIds.has(trimmedModel) || provider?.modelDiscovery?.allowCustomModels === true) {
    return { ok: true }
  }

  if (!provider) {
    return {
      ok: false,
      error: `Unknown provider "${agentType}"`,
      validIds: [],
    }
  }

  return {
    ok: false,
    error: `Model "${trimmedModel}" is not valid for provider "${agentType}"`,
    validIds,
  }
}

export function validateModelForAgentType(
  agentType: string,
  model: string | null,
  context: ProviderModelDiscoveryContext = {},
): ModelValidationResult {
  const provider = getProvider(agentType)
  if (!provider) {
    return validateResolvedModel(agentType, model, undefined, [])
  }
  const resolved = getCachedProviderModelsForValidation(provider, context)
  return validateResolvedModel(agentType, model, provider, resolved.models)
}

export async function validateResolvedModelForAgentType(
  agentType: string,
  model: string | null,
  context: ProviderModelDiscoveryContext = {},
  options: ResolveProviderModelsOptions = {},
): Promise<ModelValidationResult> {
  const provider = getProvider(agentType)
  if (!provider) {
    return validateResolvedModel(agentType, model, undefined, [])
  }
  const resolved = await resolveProviderModels(provider, context, options)
  return validateResolvedModel(agentType, model, provider, resolved.models)
}
