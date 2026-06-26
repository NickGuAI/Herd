import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'

export const FONT_SCALE_MIN = 0.8
export const FONT_SCALE_MAX = 1.6
export const FONT_SCALE_STEP = 0.1
export const DEFAULT_FONT_SCALE = 1

type AppTheme = 'light' | 'dark'

export interface AppSettings {
  theme: AppTheme
  fontScale: number
  updatedAt?: string
}

interface AppSettingsResponse {
  settings?: Partial<AppSettings>
}

interface UseFontScaleOptions {
  applyToDocument?: boolean
}

const SETTINGS_QUERY_KEY = ['settings'] as const

function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export function normalizeFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_FONT_SCALE
  }
  const rounded = Math.round(value * 10) / 10
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, rounded))
}

function formatFontScale(value: number): string {
  return normalizeFontScale(value).toFixed(1)
}

function normalizeSettings(payload: unknown): AppSettings {
  const source = (
    typeof payload === 'object' && payload !== null && 'settings' in payload
      ? (payload as AppSettingsResponse).settings
      : payload
  ) as Partial<AppSettings> | undefined

  return {
    theme: normalizeTheme(source?.theme),
    fontScale: normalizeFontScale(source?.fontScale),
    updatedAt: typeof source?.updatedAt === 'string' ? source.updatedAt : undefined,
  }
}

function readDocumentFontScale(): number {
  if (typeof document === 'undefined') {
    return DEFAULT_FONT_SCALE
  }
  const raw = document.documentElement.style.getPropertyValue('--hv-font-scale')
  if (!raw.trim()) {
    return DEFAULT_FONT_SCALE
  }
  return normalizeFontScale(Number(raw))
}

function applyDocumentFontScale(fontScale: number): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.style.setProperty('--hv-font-scale', formatFontScale(fontScale))
}

async function fetchSettings(): Promise<AppSettings> {
  return normalizeSettings(await fetchJson<unknown>('/api/settings'))
}

async function patchFontScale(fontScale: number): Promise<AppSettings> {
  return normalizeSettings(await fetchJson<unknown>('/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fontScale: normalizeFontScale(fontScale) }),
  }))
}

export function useFontScale(options: UseFontScaleOptions = {}) {
  const queryClient = useQueryClient()
  const mutationVersionRef = useRef(0)
  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettings,
    staleTime: 30_000,
  })
  const fontScale = settingsQuery.data?.fontScale ?? readDocumentFontScale()

  const fontScaleMutation = useMutation({
    mutationFn: async (nextFontScale: number) => {
      const version = ++mutationVersionRef.current
      const result = await patchFontScale(nextFontScale)
      return { result, version }
    },
    onMutate: async (nextFontScale) => {
      const normalizedScale = normalizeFontScale(nextFontScale)
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY })
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_QUERY_KEY)
      const previousFontScale = previous?.fontScale ?? readDocumentFontScale()
      if (previous) {
        queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, {
          ...previous,
          fontScale: normalizedScale,
        })
      }
      applyDocumentFontScale(normalizedScale)
      return { previous, previousFontScale }
    },
    onError: (_error, _nextFontScale, context) => {
      if (context?.previous) {
        queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, context.previous)
        applyDocumentFontScale(context.previous.fontScale)
        return
      }

      applyDocumentFontScale(context?.previousFontScale ?? DEFAULT_FONT_SCALE)
    },
    onSuccess: ({ result, version }) => {
      if (version !== mutationVersionRef.current) {
        return
      }
      queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, result)
      applyDocumentFontScale(result.fontScale)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
    },
  })

  useEffect(() => {
    if (options.applyToDocument) {
      applyDocumentFontScale(fontScale)
    }
  }, [fontScale, options.applyToDocument])

  const setFontScale = useCallback((nextFontScale: number) => {
    fontScaleMutation.mutate(normalizeFontScale(nextFontScale))
  }, [fontScaleMutation])

  const adjustFontScale = useCallback((delta: number) => {
    setFontScale(fontScale + delta)
  }, [fontScale, setFontScale])

  const resetFontScale = useCallback(() => {
    setFontScale(DEFAULT_FONT_SCALE)
  }, [setFontScale])

  return {
    fontScale,
    setFontScale,
    adjustFontScale,
    resetFontScale,
    minFontScale: FONT_SCALE_MIN,
    maxFontScale: FONT_SCALE_MAX,
    fontScaleStep: FONT_SCALE_STEP,
    isLoading: settingsQuery.isLoading,
    isSaving: fontScaleMutation.isPending,
  }
}
