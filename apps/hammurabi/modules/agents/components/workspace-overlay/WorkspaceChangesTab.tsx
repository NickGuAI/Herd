import { Check, GitBranch, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceGitStatus, WorkspaceTreeNode } from '../../../workspace/types'

interface WorkspaceChangesTabProps {
  gitStatus: WorkspaceGitStatus | undefined
  error: unknown
  isLoading: boolean
  addedPaths: Set<string>
  onAddPath: (path: string, knownType?: WorkspaceTreeNode['type']) => void
}

export function WorkspaceChangesTab({
  gitStatus,
  error,
  isLoading,
  addedPaths,
  onAddPath,
}: WorkspaceChangesTabProps) {
  return (
    <div className="h-full min-h-[200px] overflow-y-auto">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-[color:var(--hv-fg-subtle)]">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading git status...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
          {error instanceof Error ? error.message : 'Failed to load git status'}
        </div>
      ) : gitStatus && !gitStatus.enabled ? (
        <div className="flex flex-col items-center justify-center py-8 text-sm text-[color:var(--hv-fg-subtle)]">
          <GitBranch size={18} className="mb-2" />
          Git is not initialized
        </div>
      ) : gitStatus ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[color:var(--hv-fg-subtle)]">
            <GitBranch size={12} />
            <span className="font-mono">{gitStatus.branch ?? 'detached'}</span>
            {gitStatus.ahead > 0 && (
              <span className="text-[color:var(--hv-accent-success)]">+{gitStatus.ahead}</span>
            )}
            {gitStatus.behind > 0 && (
              <span className="text-[color:var(--hv-accent-danger)]">-{gitStatus.behind}</span>
            )}
          </div>
          {gitStatus.entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-[color:var(--hv-fg-subtle)]">
              Working tree clean
            </p>
          ) : (
            <div className="space-y-1">
              {gitStatus.entries.map((entry) => {
                const isAdded = addedPaths.has(entry.path)

                return (
                  <div
                    key={entry.path}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                      isAdded ? 'bg-[var(--hv-accent-success-wash)]' : 'hover:bg-[var(--hv-surface-hover)]',
                    )}
                  >
                    <span
                      className={cn(
                        'w-5 shrink-0 text-center font-mono text-[10px]',
                        entry.code.includes('M') && 'text-amber-500',
                        entry.code.includes('A') && 'text-[color:var(--hv-accent-success)]',
                        entry.code.includes('D') && 'text-[color:var(--hv-accent-danger)]',
                        entry.code.includes('?') && 'text-[color:var(--hv-fg-faint)]',
                      )}
                    >
                      {entry.code.trim()}
                    </span>
                    <span className="truncate font-mono text-[color:var(--hv-fg-muted)]">
                      {entry.path}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        'ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                        isAdded
                          ? 'bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)] hover:bg-[var(--hv-accent-success-wash)]'
                          : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]',
                      )}
                      onClick={() => onAddPath(entry.path, 'file')}
                      aria-label={isAdded ? `Added ${entry.path}` : `Add ${entry.path} to context`}
                    >
                      {isAdded ? <Check size={11} /> : <Plus size={11} />}
                      {isAdded ? 'Added' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
