import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import type { WorkspaceTreeNode } from '../../../workspace/types'
import { WorkspaceTree } from '../../../workspace/components/WorkspaceTree'
import type { WorkspaceOverlayTreeError } from './use-workspace-overlay-tree'

interface WorkspaceFilesTabProps {
  filteredNodesByParent: Record<string, WorkspaceTreeNode[]>
  expandedPaths: Set<string>
  loadingPaths: Set<string>
  addedPaths: Set<string>
  selectedPath: string | null
  error?: WorkspaceOverlayTreeError | null
  downloadingPath?: string | null
  onSelectPath: (path: string) => void
  onToggleDirectory: (path: string) => void
  onAddPath: (path: string, knownType?: WorkspaceTreeNode['type']) => void
  onDownloadPath?: (path: string, knownType?: WorkspaceTreeNode['type']) => void
  onRetry?: () => void
}

export function WorkspaceFilesTab({
  filteredNodesByParent,
  expandedPaths,
  loadingPaths,
  addedPaths,
  selectedPath,
  error = null,
  downloadingPath = null,
  onSelectPath,
  onToggleDirectory,
  onAddPath,
  onDownloadPath,
  onRetry,
}: WorkspaceFilesTabProps) {
  const errorBanner = error ? (
    <div className="rounded-md border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
      <div className="flex items-start gap-2">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="break-words">{error.message}</div>
          {onRetry && (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-current px-2 py-1 text-xs transition-colors hover:bg-[var(--hv-surface-hover)]"
              onClick={onRetry}
            >
              <RefreshCw size={12} />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="flex h-full min-h-[200px] min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden">
      {filteredNodesByParent[''] ? (
        <>
          {errorBanner}
          <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] p-2">
            <WorkspaceTree
              nodesByParent={filteredNodesByParent}
              expandedPaths={expandedPaths}
              loadingPaths={loadingPaths}
              addedPaths={addedPaths}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              onToggleDirectory={onToggleDirectory}
              onAddPath={onAddPath}
              onDownloadPath={onDownloadPath}
              downloadingPath={downloadingPath}
              selectDirectoriesOnClick={false}
            />
          </div>
        </>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center py-8">
          {errorBanner}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center py-8 text-sm text-[color:var(--hv-fg-subtle)]">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading workspace...
        </div>
      )}
    </div>
  )
}
