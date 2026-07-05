import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'

export type AppTheme = 'light' | 'dark' | 'system'
export type ResolvedAppTheme = 'light' | 'dark'

export interface AppSettings {
  theme: AppTheme
  fontScale: number
  updatedAt?: string
}

interface AppSettingsResponse {
  settings?: AppSettings
}

interface ThemeContextValue {
  theme: AppTheme
  /** `theme` with `system` resolved against `prefers-color-scheme`. */
  resolvedTheme: ResolvedAppTheme
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
  isLoading: boolean
  isSaving: boolean
}

const SETTINGS_QUERY_KEY = ['settings'] as const
const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' || value === 'system' ? value : 'light'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches
}

function resolveTheme(theme: AppTheme): ResolvedAppTheme {
  if (theme === 'system') {
    return systemPrefersDark() ? 'dark' : 'light'
  }
  return theme
}

function subscribeToSystemTheme(onChange: () => void): (() => void) | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return undefined
  }
  const media = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY)
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }
  // Older WebKit only exposes the deprecated listener API.
  if (typeof media.addListener === 'function') {
    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }
  return undefined
}

function normalizeSettings(payload: unknown): AppSettings {
  const source = (
    typeof payload === 'object' && payload !== null && 'settings' in payload
      ? (payload as AppSettingsResponse).settings
      : payload
  ) as AppSettings | undefined

  return {
    theme: normalizeTheme(source?.theme),
    fontScale: typeof source?.fontScale === 'number' && Number.isFinite(source.fontScale)
      ? source.fontScale
      : 1,
    updatedAt: typeof source?.updatedAt === 'string' ? source.updatedAt : undefined,
  }
}

function readDocumentTheme(): AppTheme {
  if (typeof document === 'undefined') {
    return 'light'
  }
  const datasetTheme = document.documentElement.dataset.theme
  if (datasetTheme === 'dark' || datasetTheme === 'light' || datasetTheme === 'system') {
    return datasetTheme
  }
  return document.documentElement.classList.contains('hv-dark') ? 'dark' : 'light'
}

export function getHervaldThemeClassName(theme: AppTheme): 'hv-light' | 'hv-dark' {
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('hv-dark')) {
      return 'hv-dark'
    }
    if (document.documentElement.classList.contains('hv-light')) {
      return 'hv-light'
    }
  }
  return resolveTheme(theme) === 'dark' ? 'hv-dark' : 'hv-light'
}

function applyDocumentTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.classList.remove('hv-light', 'hv-dark')
  document.documentElement.classList.add(resolveTheme(theme) === 'dark' ? 'hv-dark' : 'hv-light')
  document.documentElement.dataset.theme = theme
}

async function fetchSettings(): Promise<AppSettings> {
  return normalizeSettings(await fetchJson<unknown>('/api/settings'))
}

async function patchTheme(theme: AppTheme): Promise<AppSettings> {
  return normalizeSettings(await fetchJson<unknown>('/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ theme }),
  }))
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const fallbackTheme = readDocumentTheme()
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettings,
    staleTime: 30_000,
  })
  const theme = settingsQuery.data?.theme ?? fallbackTheme
  const resolvedTheme: ResolvedAppTheme = theme === 'system'
    ? (systemDark ? 'dark' : 'light')
    : theme

  const themeMutation = useMutation({
    mutationFn: patchTheme,
    onMutate: async (nextTheme) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY })
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_QUERY_KEY)
      const previousTheme = previous?.theme ?? readDocumentTheme()
      queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, {
        ...(previous ?? { updatedAt: new Date().toISOString() }),
        theme: nextTheme,
      })
      applyDocumentTheme(nextTheme)
      return { previous, previousTheme }
    },
    onError: (_error, _nextTheme, context) => {
      if (context?.previous) {
        queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, context.previous)
        applyDocumentTheme(context.previous.theme)
        return
      }

      applyDocumentTheme(context?.previousTheme ?? 'light')
    },
    onSuccess: (settings) => {
      queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, settings)
      applyDocumentTheme(settings.theme)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
    },
  })

  // Track the OS preference so a persisted `system` theme follows
  // prefers-color-scheme live, without a reload.
  useEffect(() => {
    return subscribeToSystemTheme(() => {
      setSystemDark(systemPrefersDark())
    })
  }, [])

  useEffect(() => {
    applyDocumentTheme(theme)
  }, [theme, resolvedTheme])

  const setTheme = useCallback((nextTheme: AppTheme) => {
    themeMutation.mutate(normalizeTheme(nextTheme))
  }, [themeMutation])

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isLoading: settingsQuery.isLoading,
    isSaving: themeMutation.isPending,
  }), [
    resolvedTheme,
    setTheme,
    settingsQuery.isLoading,
    theme,
    themeMutation.isPending,
    toggleTheme,
  ])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context) {
    return context
  }

  const theme = readDocumentTheme()
  const resolvedTheme = resolveTheme(theme)
  return {
    theme,
    resolvedTheme,
    setTheme: applyDocumentTheme,
    toggleTheme: () => applyDocumentTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
    isLoading: false,
    isSaving: false,
  }
}
