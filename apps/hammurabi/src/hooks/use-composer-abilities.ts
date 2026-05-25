import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import {
  createCustomComposerAbility,
  getDefaultComposerAbilitySettings,
  mergeComposerAbilitySettingsPatch,
  normalizePersistedComposerAbilitySettings,
  resolveEnabledComposerAbilities,
  type ComposerAbility,
  type ComposerAbilitySettings,
} from '@modules/settings/composer-abilities'

interface AppSettingsResponse {
  settings?: {
    composerAbilities?: unknown
  }
}

function normalizeComposerAbilitySettings(payload: unknown): ComposerAbilitySettings {
  const source = (
    typeof payload === 'object' && payload !== null && 'settings' in payload
      ? (payload as AppSettingsResponse).settings?.composerAbilities
      : payload
  )
  return normalizePersistedComposerAbilitySettings(source)
}

async function fetchComposerAbilitySettings(): Promise<ComposerAbilitySettings> {
  return normalizeComposerAbilitySettings(await fetchJson<unknown>('/api/settings'))
}

async function patchComposerAbilitySettings(settings: ComposerAbilitySettings): Promise<ComposerAbilitySettings> {
  return normalizeComposerAbilitySettings(await fetchJson<unknown>('/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ composerAbilities: settings }),
  }))
}

export function useComposerAbilities(): {
  abilities: ComposerAbility[]
  settings: ComposerAbilitySettings
  customAbilitiesEnabled: boolean
  addCustomAbility: (label: string, prompt: string) => Promise<boolean>
  removeCustomAbility: (id: string) => Promise<boolean>
  isLoading: boolean
  isSaving: boolean
} {
  const [settings, setSettings] = useState<ComposerAbilitySettings>(() => getDefaultComposerAbilitySettings())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let disposed = false

    async function loadSettings() {
      try {
        const nextSettings = await fetchComposerAbilitySettings()
        if (!disposed) {
          setSettings(nextSettings)
        }
      } catch {
        // Keep built-in defaults available when settings are unavailable.
      } finally {
        if (!disposed) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      disposed = true
    }
  }, [])

  const persistSettings = useCallback(async (nextSettings: ComposerAbilitySettings): Promise<boolean> => {
    const previous = settings
    setSettings(nextSettings)
    setIsSaving(true)
    try {
      const savedSettings = await patchComposerAbilitySettings(nextSettings)
      setSettings(savedSettings)
      return true
    } catch {
      setSettings(previous)
      return false
    } finally {
      setIsSaving(false)
    }
  }, [settings])

  const addCustomAbility = useCallback(async (label: string, prompt: string): Promise<boolean> => {
    const existingIds = [
      ...settings.defaultAbilities.map((ability) => ability.id),
      ...settings.customAbilities.map((ability) => ability.id),
    ]
    const ability = createCustomComposerAbility(label, prompt, existingIds)
    if (!ability) {
      return false
    }

    const nextSettings = mergeComposerAbilitySettingsPatch(settings, {
      customAbilities: [...settings.customAbilities, ability],
    })
    return persistSettings(nextSettings)
  }, [persistSettings, settings])

  const removeCustomAbility = useCallback(async (id: string): Promise<boolean> => {
    if (!settings.customAbilities.some((ability) => ability.id === id)) {
      return false
    }

    const nextSettings = mergeComposerAbilitySettingsPatch(settings, {
      customAbilities: settings.customAbilities.filter((ability) => ability.id !== id),
    })
    return persistSettings(nextSettings)
  }, [persistSettings, settings])

  return {
    abilities: resolveEnabledComposerAbilities(settings),
    settings,
    customAbilitiesEnabled: settings.customAbilitiesEnabled,
    addCustomAbility,
    removeCustomAbility,
    isLoading,
    isSaving,
  }
}
