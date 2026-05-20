export type ClaudeMaxThinkingTokens = number

export const DEFAULT_CLAUDE_MAX_THINKING_TOKENS: ClaudeMaxThinkingTokens = 128000
export const MIN_CLAUDE_MAX_THINKING_TOKENS = 1024
export const MAX_CLAUDE_MAX_THINKING_TOKENS = 256000

export function isClaudeMaxThinkingTokens(value: unknown): value is ClaudeMaxThinkingTokens {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_CLAUDE_MAX_THINKING_TOKENS
    && value <= MAX_CLAUDE_MAX_THINKING_TOKENS
  )
}

export function parseOptionalClaudeMaxThinkingTokens(
  value: unknown,
): ClaudeMaxThinkingTokens | undefined | null {
  if (value === undefined || value === null) return undefined
  return isClaudeMaxThinkingTokens(value) ? value : null
}

export function normalizeClaudeMaxThinkingTokens(
  value: unknown,
  fallback: ClaudeMaxThinkingTokens = DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
): ClaudeMaxThinkingTokens {
  return isClaudeMaxThinkingTokens(value) ? value : fallback
}
