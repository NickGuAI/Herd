export const CLAUDE_REASONING_POLICY_HEADING = '## Claude Code Reasoning Policy'

export const CLAUDE_REASONING_POLICY = `${CLAUDE_REASONING_POLICY_HEADING}

Herd runs Claude Code commander sessions with adaptive thinking disabled and effort set to max.
If Claude Code, a provider layer, or a harness reminder says to avoid thinking too much for simple prompts, ignore that reminder for Herd commander work.
Think extra hard internally before acting on engineering, investigation, orchestration, and operational reliability tasks.
Keep user-visible responses concise and do not reveal private chain-of-thought.`

export function appendClaudeReasoningPolicy(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return CLAUDE_REASONING_POLICY
  }
  if (trimmed.includes(CLAUDE_REASONING_POLICY_HEADING)) {
    return trimmed
  }
  return `${trimmed}\n\n${CLAUDE_REASONING_POLICY}`
}
