import { GitBranch, GitCommitHorizontal, Loader2 } from 'lucide-react'
import type { WorkspaceGitLog } from '../../../workspace/types'

interface WorkspaceLogTabProps {
  gitLog: WorkspaceGitLog | undefined
  error: unknown
  isLoading: boolean
}

export function WorkspaceLogTab({
  gitLog,
  error,
  isLoading,
}: WorkspaceLogTabProps) {
  return (
    <div className="h-full min-h-[200px] overflow-y-auto">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-[color:var(--hv-fg-subtle)]">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading git log...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
          {error instanceof Error ? error.message : 'Failed to load git log'}
        </div>
      ) : gitLog && !gitLog.enabled ? (
        <div className="flex flex-col items-center justify-center py-8 text-sm text-[color:var(--hv-fg-subtle)]">
          <GitBranch size={18} className="mb-2" />
          Git is not initialized
        </div>
      ) : gitLog ? (
        <div className="space-y-1">
          {gitLog.commits.length === 0 ? (
            <p className="py-4 text-center text-sm text-[color:var(--hv-fg-subtle)]">
              No commits yet
            </p>
          ) : (
            gitLog.commits.map((commit) => (
              <div
                key={commit.hash}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs"
              >
                <GitCommitHorizontal
                  size={12}
                  className="mt-0.5 shrink-0 text-[color:var(--hv-fg-faint)]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[color:var(--hv-fg)]">{commit.subject}</p>
                  <p className="font-mono text-[10px] text-[color:var(--hv-fg-subtle)]">
                    {commit.shortHash} &middot; {commit.author}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
