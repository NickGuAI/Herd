import type { ProviderRegistryEntry } from '@/types'

const baseCapabilities: ProviderRegistryEntry['capabilities'] = {
  supportsAutomation: true,
  supportsCommanderConversation: true,
  supportsWorkerDispatch: true,
  supportsMessageImages: true,
}

const baseUiCapabilities: ProviderRegistryEntry['uiCapabilities'] = {
  supportsEffort: false,
  supportsAdaptiveThinking: false,
  supportsMaxThinkingTokens: false,
  supportsSkills: false,
  supportsLoginMode: false,
  permissionModes: [
    {
      value: 'default',
      label: 'Default',
      description: 'Use provider-managed permissions.',
    },
  ],
}

export const testProviderRegistry: ProviderRegistryEntry[] = [
  {
    id: 'claude',
    label: 'Claude',
    eventProvider: 'claude',
    capabilities: baseCapabilities,
    uiCapabilities: {
      ...baseUiCapabilities,
      supportsEffort: true,
      supportsAdaptiveThinking: true,
      supportsMaxThinkingTokens: true,
      supportsSkills: true,
      supportsLoginMode: true,
    },
    availableModels: [
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        default: true,
      },
    ],
    supportedTransports: ['stream', 'pty'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: 'claude-sonnet-4-6',
    },
    disabledReason: null,
  },
  {
    id: 'codex',
    label: 'Codex',
    eventProvider: 'codex',
    capabilities: baseCapabilities,
    uiCapabilities: {
      ...baseUiCapabilities,
      forcedTransport: 'stream',
    },
    availableModels: [
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        default: true,
      },
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
      },
    ],
    supportedTransports: ['stream'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: 'gpt-5.5',
    },
    disabledReason: null,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    eventProvider: 'gemini',
    capabilities: baseCapabilities,
    uiCapabilities: {
      ...baseUiCapabilities,
      forcedTransport: 'stream',
    },
    availableModels: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro Preview',
        default: true,
      },
    ],
    supportedTransports: ['stream'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: 'gemini-3.1-pro-preview',
    },
    disabledReason: null,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    eventProvider: 'opencode',
    capabilities: baseCapabilities,
    uiCapabilities: {
      ...baseUiCapabilities,
      forcedTransport: 'stream',
    },
    availableModels: [],
    supportedTransports: ['stream'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: null,
    },
    disabledReason: null,
  },
]
