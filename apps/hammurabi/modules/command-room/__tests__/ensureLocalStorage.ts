export function ensureLocalStorage(): Storage {
  const existing = readWindowStorage()
  if (existing) {
    defineStorage(globalThis, existing)
    return existing
  }

  const existingGlobal = readGlobalStorage()
  if (existingGlobal) {
    if (typeof window !== 'undefined') {
      defineStorage(window, existingGlobal)
    }
    return existingGlobal
  }

  const storage = createMemoryStorage()
  if (typeof window !== 'undefined') {
    defineStorage(window, storage)
  }
  defineStorage(globalThis, storage)

  return storage
}

function readWindowStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    if (window.localStorage) return window.localStorage
  } catch {
    // Fall through to a test-local storage shim when jsdom storage is unavailable.
  }

  return null
}

function readGlobalStorage(): Storage | null {
  try {
    if (globalThis.localStorage) return globalThis.localStorage
  } catch {
    // Node 26 exposes localStorage behind --localstorage-file; replace it in tests.
  }

  return null
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    get length() {
      return store.size
    },
  } satisfies Storage
}

function defineStorage(target: object, storage: Storage): void {
  Object.defineProperty(target, 'localStorage', {
    configurable: true,
    value: storage,
  })
}
