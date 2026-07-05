interface AutomationPromptScope {
  kind: 'global' | 'commander'
  commander?: {
    id: string
    displayName?: string | null
    host?: string | null
  }
}

export function buildGaiaCreateCommanderPrompt(): string {
  return [
    'Please help me create a new Herd commander.',
    '',
    'Start by asking what responsibility this commander should own. Then gather only the missing details needed to create it: host/display name, provider/model, workspace directory, identity and operating style, heartbeat behavior, and any task source.',
    '',
    'Base the final proposal on Herd\'s current commander creation contract. Before creating anything, show me the reviewed commander configuration and ask me to confirm it.',
  ].join('\n')
}

export function buildGaiaCreateMachinePrompt(): string {
  return [
    'Please help me add a Herd machine.',
    '',
    'Guide me through registering a machine that Herd can launch sessions on. Gather the machine label, hostname or Tailscale status JSON, SSH user and port, absolute workspace directory, and provider auth requirements.',
    '',
    'Use the current Herd machine setup and provider-auth contracts before proposing commands or values. Before creating anything, show me the reviewed machine configuration and ask me to confirm it.',
  ].join('\n')
}

export function buildGaiaCreateAutomationPrompt(scope: AutomationPromptScope): string {
  const scopeLine = scope.kind === 'commander'
    ? `Scope: commander ${scope.commander?.displayName?.trim() || scope.commander?.host?.trim() || scope.commander?.id || 'selected commander'}.`
    : 'Scope: global automation.'

  return [
    'Please help me create a Herd automation.',
    '',
    scopeLine,
    '',
    'First decide with me whether this should be an Instruction Run or a Persistent Automation. Then gather only the missing details: trigger, schedule or event source, workspace and machine, provider/model, instruction, skills, observations, seed memory, and run limits.',
    '',
    'Base the final proposal on Herd\'s current automation creation contract. Before creating anything, show me the reviewed automation configuration and ask me to confirm it.',
  ].join('\n')
}
