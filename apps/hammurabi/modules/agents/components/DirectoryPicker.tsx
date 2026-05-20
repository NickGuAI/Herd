import { useEffect, useState } from 'react'
import { ChevronRight, ChevronUp, Folder, FolderOpen } from 'lucide-react'
import { useDirectories } from '@/hooks/use-agents'

export function DirectoryPicker({
  value,
  onChange,
  host,
}: {
  value: string
  onChange: (dir: string) => void
  host?: string
}) {
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined)
  const [isOpen, setIsOpen] = useState(false)
  const [homeDir, setHomeDir] = useState<string | undefined>(undefined)
  const { data, error, isLoading } = useDirectories(browsePath, isOpen, host)

  // Reset browse state when host changes
  useEffect(() => {
    setBrowsePath(undefined)
    setHomeDir(undefined)
  }, [host])

  // Capture the home directory from the initial (default) response
  useEffect(() => {
    if (data?.parent && homeDir === undefined && browsePath === undefined) {
      setHomeDir(data.parent)
    }
  }, [data?.parent, homeDir, browsePath])

  const canGoUp = Boolean(homeDir && data?.parent && data.parent !== homeDir)

  function handleSelect(dir: string) {
    onChange(dir)
    setIsOpen(false)
  }

  function handleBrowse(dir: string) {
    setBrowsePath(dir)
  }

  function handleGoUp() {
    if (canGoUp && data?.parent) {
      const parent = data.parent.replace(/\/[^/]+$/, '') || '/'
      setBrowsePath(parent)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] font-mono text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]"
          placeholder="~ (home directory)"
        />
        <button
          type="button"
          onClick={() => {
            setIsOpen((c) => !c)
            if (!isOpen && value) {
              setBrowsePath(value)
            }
          }}
          className="p-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] hover:bg-[var(--hv-surface-hover)] transition-colors"
          aria-label="Browse directories"
        >
          <FolderOpen size={16} className="text-[color:var(--hv-fg-subtle)]" />
        </button>
      </div>

      {isOpen && (
        <div className="mt-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] max-h-48 overflow-y-auto">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-selected)]">
            <button
              type="button"
              onClick={handleGoUp}
              disabled={!canGoUp}
              className="p-1 rounded hover:bg-[var(--hv-bg-raised)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              aria-label="Go to parent directory"
            >
              <ChevronUp size={14} className="text-[color:var(--hv-fg-subtle)]" />
            </button>
            <span className="font-mono text-xs text-[color:var(--hv-fg-muted)] truncate">
              {data?.parent ?? '~'}
            </span>
          </div>
          {error ? (
            <div className="px-3 py-3 text-xs text-[color:var(--hv-accent-danger)]">
              {error instanceof Error ? error.message : 'Failed to load directories'}
            </div>
          ) : isLoading && !data ? (
            <div className="px-3 py-3 text-xs text-[color:var(--hv-fg-faint)]">Loading directories…</div>
          ) : data?.directories.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[color:var(--hv-fg-faint)]">No subdirectories</div>
          ) : (
            data?.directories.map((dir) => (
              <div key={dir} className="flex items-center">
                <button
                  type="button"
                  onClick={() => handleSelect(dir)}
                  className="flex-1 flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--hv-surface-hover)] transition-colors"
                >
                  <Folder size={14} className="text-[color:var(--hv-fg-faint)] shrink-0" />
                  <span className="font-mono text-xs text-[color:var(--hv-fg)] truncate">
                    {dir.split('/').pop()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBrowse(dir)}
                  className="px-2 py-2 text-[color:var(--hv-fg-faint)] hover:text-[color:var(--hv-fg)] transition-colors"
                  aria-label={`Browse into ${dir.split('/').pop()}`}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
        Leave empty to use the home directory
      </p>
    </div>
  )
}
