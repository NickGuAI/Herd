import type { ProviderModelOption } from '../../providers/provider-adapter.js'

export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.5'

export const CODEX_MODEL_EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const
export const GPT_5_6_SOL_EFFORT_LEVELS = [...CODEX_MODEL_EFFORT_LEVELS, 'ultra'] as const

export function getCodexModelEffortLevels(modelId: string): string[] {
  return modelId === 'gpt-5.6-sol'
    ? [...GPT_5_6_SOL_EFFORT_LEVELS]
    : [...CODEX_MODEL_EFFORT_LEVELS]
}

function codexModel(
  option: Omit<ProviderModelOption, 'supportsEffort' | 'supportedEffortLevels' | 'defaultEffort'>,
): ProviderModelOption {
  return {
    ...option,
    supportsEffort: true,
    supportedEffortLevels: getCodexModelEffortLevels(option.id),
    defaultEffort: 'max',
  }
}

export const availableModels = [
  codexModel({
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 SOL',
    description: 'Frontier Codex model with ultra reasoning support.',
  }),
  codexModel({
    id: DEFAULT_CODEX_MODEL_ID,
    label: 'GPT-5.5',
    description: 'Frontier Codex model for complex coding and research.',
    default: true,
  }),
  codexModel({
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Strong general-purpose Codex model.',
  }),
  codexModel({
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Fast lower-cost Codex model.',
  }),
  codexModel({
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    description: 'Coding-optimized Codex model.',
  }),
  codexModel({
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3 Codex Spark',
    description: 'Ultra-fast Codex model for quick iteration.',
  }),
] satisfies ProviderModelOption[]
