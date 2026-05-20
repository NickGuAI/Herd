import { WorkspaceOverlay } from '@modules/agents/components/WorkspaceOverlay'
import type { WorkspaceSource } from '@modules/workspace/use-workspace'
import type { WorkspaceTreeNode } from '@modules/workspace/types'

interface MobileWorkspaceSheetProps {
  open: boolean
  source: WorkspaceSource | null
  onClose: () => void
  onSelectFile: (filePath: string, type: WorkspaceTreeNode['type']) => void
  requestedPath?: string | null
  requestedPathToken?: number
}

export function MobileWorkspaceSheet({
  open,
  source,
  onClose,
  onSelectFile,
  requestedPath,
  requestedPathToken = 0,
}: MobileWorkspaceSheetProps) {
  if (!open || !source) {
    return null
  }

  return (
    <WorkspaceOverlay
      open={open}
      onClose={onClose}
      onSelectFile={(filePath, type) => {
        onSelectFile(filePath, type)
        onClose()
      }}
      source={source}
      requestedPath={requestedPath}
      requestedPathToken={requestedPathToken}
    />
  )
}
