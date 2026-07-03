import type {
  ChannelDescriptorField,
  ChannelProviderDescriptor,
  CommanderChannelBinding,
} from './types.js'

export type ChannelFormValue = string | boolean
export type ChannelFormState = Record<string, ChannelFormValue>
export type ChannelFieldErrors = Record<string, string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isIdentityField(field: ChannelDescriptorField): boolean {
  const key = field.key
  return field.section === 'identity' || key === 'accountId' || key === 'displayName'
}

function isEmptyFormValue(value: ChannelFormValue | undefined): boolean {
  return typeof value === 'boolean'
    ? false
    : !value?.trim()
}

function normalizeNumberForForm(field: ChannelDescriptorField, value: number): string {
  const multiplier = field.storageMultiplier ?? 1
  const normalized = multiplier > 1 ? value / multiplier : value
  return String(Math.trunc(normalized))
}

export function normalizeChannelFormValue(field: ChannelDescriptorField, value: unknown): ChannelFormValue {
  if (field.kind === 'checkbox') {
    return typeof value === 'boolean' ? value : false
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).join('\n')
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeNumberForForm(field, value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return typeof value === 'string' ? value : ''
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    return (current as Record<string, unknown>)[part]
  }, source)
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1] ?? path] = value
}

function cloneConfigDefaults(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value)
}

function textareaToList(value: string): string[] {
  return [...new Set(value
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean))]
}

function formValueForConfig(field: ChannelDescriptorField, value: ChannelFormValue | undefined): unknown {
  if (field.kind === 'checkbox') {
    return value === true
  }
  if (field.kind === 'textarea') {
    return textareaToList(typeof value === 'string' ? value : '')
  }
  const text = typeof value === 'string' ? value.trim() : ''
  if (field.secret && !text) {
    return undefined
  }
  if (!text && field.defaultValue === undefined) {
    return undefined
  }
  if (field.kind === 'number') {
    const parsed = Number(text || field.defaultValue)
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
    if (normalized === undefined) {
      return undefined
    }
    return normalized * (field.storageMultiplier ?? 1)
  }
  return text || normalizeChannelFormValue(field, field.defaultValue)
}

export function formStateFromDescriptor(
  descriptor: ChannelProviderDescriptor,
  binding?: CommanderChannelBinding,
): ChannelFormState {
  const state: ChannelFormState = {}
  for (const field of descriptor.fields) {
    const key = field.key
    const defaultValue = descriptor.formDefaults[key] ?? field.defaultValue ?? ''
    state[key] = normalizeChannelFormValue(field, defaultValue)
  }
  if (!binding) {
    return state
  }

  state.accountId = binding.accountId
  state.displayName = binding.displayName
  const config = binding.config && typeof binding.config === 'object'
    ? binding.config as Record<string, unknown>
    : {}
  for (const field of descriptor.fields) {
    const key = field.key
    if (key === 'accountId' || key === 'displayName') {
      continue
    }
    if (field.secret) {
      state[key] = ''
      continue
    }
    const configValue = field.configPath ? readPath(config, field.configPath) : config[key]
    if (configValue !== undefined) {
      state[key] = normalizeChannelFormValue(field, configValue)
    }
  }
  return state
}

export function buildChannelConfigFromFormIntent(
  descriptor: ChannelProviderDescriptor,
  state: ChannelFormState,
): Record<string, unknown> {
  const config = cloneConfigDefaults(descriptor.configDefaults)
  for (const field of descriptor.fields) {
    const key = field.key
    if (key === 'accountId' || key === 'displayName') {
      continue
    }
    const value = formValueForConfig(field, state[key])
    if (value === undefined) {
      continue
    }
    setPath(config, field.configPath ?? key, value)
  }
  return config
}

export function getChannelFormFieldErrors(
  descriptor: ChannelProviderDescriptor,
  state: ChannelFormState,
  options: { existingCredentialConfigured?: boolean } = {},
): ChannelFieldErrors {
  return descriptor.fields.reduce<ChannelFieldErrors>((errors, field) => {
    const key = field.key
    const value = state[key]
    if (field.required) {
      if (field.secret && options.existingCredentialConfigured && isEmptyFormValue(value)) {
        return errors
      }
      if (isEmptyFormValue(value)) {
        errors[key] = `${field.label} is required.`
        return errors
      }
    }
    if (field.kind === 'number' && !isEmptyFormValue(value)) {
      const parsed = Number(typeof value === 'string' ? value.trim() : value)
      if (!Number.isFinite(parsed)) {
        errors[key] = `${field.label} must be a number.`
        return errors
      }
      if (field.min !== undefined && parsed < field.min) {
        errors[key] = `${field.label} must be at least ${field.min}.`
        return errors
      }
    }
    if (field.kind === 'select' && !isEmptyFormValue(value)) {
      const allowed = new Set((field.options ?? []).map((option) => option.value))
      if (typeof value !== 'string' || !allowed.has(value)) {
        errors[key] = `${field.label} must be one of ${[...allowed].join(', ')}.`
      }
    }
    return errors
  }, {})
}

export function formStateFromRawIntent(
  descriptor: ChannelProviderDescriptor,
  raw: unknown,
): ChannelFormState | null {
  if (!isRecord(raw)) {
    return null
  }
  const state: ChannelFormState = {}
  for (const field of descriptor.fields) {
    const key = field.key
    state[key] = normalizeChannelFormValue(field, raw[key])
  }
  return state
}

export function getFirstChannelFormError(errors: ChannelFieldErrors): string | null {
  return Object.values(errors)[0] ?? null
}
