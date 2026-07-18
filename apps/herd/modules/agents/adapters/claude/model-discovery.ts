import {
  query as createClaudeQuery,
  type AccountInfo,
  type ModelInfo,
  type Query,
} from '@anthropic-ai/claude-agent-sdk'
import {
  ANTHROPIC_MODEL_ENV_KEYS,
  scrubEnvironmentVariables,
} from '../../machines.js'
import type {
  ProviderModelDiscoveryContext,
  ProviderModelDiscoveryResult,
  ProviderModelOption,
} from '../../providers/provider-adapter.js'

interface ClaudeRuntimeModelInfo extends ModelInfo {
  resolvedModel?: unknown
  supportsEffort?: unknown
  supportedEffortLevels?: unknown
  defaultEffort?: unknown
  defaultReasoningEffort?: unknown
  supportsAdaptiveThinking?: unknown
  isDefault?: unknown
}

interface ClaudeRuntimeAccountInfo extends AccountInfo {
  apiProvider?: unknown
}

export interface ClaudeModelDiscoveryDeps {
  queryFactory?: typeof createClaudeQuery
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const values = [...new Set(value.map(text).filter((entry): entry is string => Boolean(entry)))]
  return values.length > 0 ? values : undefined
}

function accountContextId(account: ClaudeRuntimeAccountInfo): string | undefined {
  const values = [
    text(account.organization),
    text(account.email),
    text(account.subscriptionType),
    text(account.apiProvider),
  ].filter((value): value is string => Boolean(value))
  return values.length > 0 ? values.join('|') : undefined
}

function mapClaudeModel(raw: ClaudeRuntimeModelInfo): ProviderModelOption | null {
  const id = text(raw.value)
  if (!id) {
    return null
  }
  const resolvedModel = text(raw.resolvedModel)
  const supportedEffortLevels = stringList(raw.supportedEffortLevels)
  const defaultEffort = text(raw.defaultEffort) ?? text(raw.defaultReasoningEffort)
  const supportsEffort = typeof raw.supportsEffort === 'boolean'
    ? raw.supportsEffort
    : supportedEffortLevels
      ? true
      : undefined
  return {
    id,
    label: text(raw.displayName) ?? id,
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(raw.isDefault === true ? { default: true } : {}),
    ...(resolvedModel && resolvedModel !== id ? { aliases: [resolvedModel] } : {}),
    ...(resolvedModel ? { resolvedModel } : {}),
    ...(supportsEffort !== undefined ? { supportsEffort } : {}),
    ...(supportedEffortLevels ? { supportedEffortLevels } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    ...(typeof raw.supportsAdaptiveThinking === 'boolean'
      ? { supportsAdaptiveThinking: raw.supportsAdaptiveThinking }
      : {}),
    runtimeCompatible: true,
  }
}

async function* idlePromptStream(): AsyncGenerator<never, void, unknown> {
  await new Promise<void>(() => {})
}

export async function discoverClaudeModels(
  context: ProviderModelDiscoveryContext,
  deps: ClaudeModelDiscoveryDeps = {},
): Promise<ProviderModelDiscoveryResult> {
  const queryFactory = deps.queryFactory ?? createClaudeQuery
  const env = scrubEnvironmentVariables(
    {
      ...process.env,
      ...context.providerAuth?.env,
    },
    ['CLAUDECODE', 'HERD_INTERNAL_TOKEN', ...ANTHROPIC_MODEL_ENV_KEYS],
  )
  const query = queryFactory({
    prompt: idlePromptStream(),
    options: {
      cwd: process.cwd(),
      env,
      tools: [],
    },
  }) as Query
  let closePromise: Promise<unknown> | null = null
  const closeQuery = () => {
    closePromise ??= Promise.resolve(query.return(undefined))
    return closePromise
  }
  const handleAbort = () => {
    void closeQuery()
  }
  context.signal?.addEventListener('abort', handleAbort, { once: true })
  try {
    const [rawModels, rawAccount] = await Promise.all([
      query.supportedModels(),
      query.accountInfo(),
    ])
    const models = (rawModels as ClaudeRuntimeModelInfo[])
      .map(mapClaudeModel)
      .filter((model): model is ProviderModelOption => Boolean(model))
    const accountId = text(context.accountId)
      ?? accountContextId(rawAccount as ClaudeRuntimeAccountInfo)
    return {
      models,
      ...(accountId ? { accountId } : {}),
    }
  } finally {
    context.signal?.removeEventListener('abort', handleAbort)
    await closeQuery()
  }
}
