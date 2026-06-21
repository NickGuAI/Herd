import { describe, expect, it } from 'vitest'
import { resolveCodexTransportPolicy } from '../session'

describe('resolveCodexTransportPolicy', () => {
  it('keeps default and acceptEdits on Hammurabi granular approval policy', () => {
    expect(resolveCodexTransportPolicy('default')).toEqual({
      sandbox: 'danger-full-access',
      approvalPolicy: {
        granular: {
          sandbox_approval: true,
          mcp_elicitations: true,
          rules: true,
          request_permissions: true,
          skill_approval: true,
        },
      },
    })
    expect(resolveCodexTransportPolicy('acceptEdits')).toEqual(resolveCodexTransportPolicy('default'))
  })

  it('maps bypassPermissions to non-interactive Codex execution', () => {
    expect(resolveCodexTransportPolicy('bypassPermissions')).toEqual({
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    })
  })
})
