/**
 * Hervald — WorkspaceModal
 *
 * Cmd+K overlay that reuses the shared workspace panel so Hervald reads the
 * same commander-scoped tree, git, and preview routes as the main workspace.
 */
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { WorkspacePanel } from '@modules/workspace/components/WorkspacePanel'
import type { WorkspaceSource } from '@modules/workspace/use-workspace'

interface WorkspaceModalProps {
  open: boolean
  onClose: () => void
  source: WorkspaceSource | null
  onInsertPath?: (path: string) => void
}

export function WorkspaceModal({ open, onClose, source, onInsertPath }: WorkspaceModalProps) {
  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title="Workspace"
      position="modal"
      portalThemeClassName="hv-dark"
      containerClassName="p-10"
      backdropClassName="bg-sumi-black/60"
      contentClassName="hv-dark"
      contentStyle={{
        width: 'min(1240px, 100%)',
        height: 'min(780px, 90vh)',
      }}
    >
      {source ? (
        <WorkspacePanel
          source={source}
          position="embedded"
          variant="dark"
          onClose={onClose}
          onInsertPath={(path) => {
            onInsertPath?.(path)
            onClose()
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--hv-bg-elevated)',
            color: 'var(--hv-fg-subtle)',
            border: '1px solid var(--hv-border-hair)',
            borderRadius: '4px 18px 4px 18px',
            boxShadow: 'var(--hv-shadow-modal)',
            padding: 32,
            textAlign: 'center',
          }}
        >
          Select a commander to inspect its workspace.
        </div>
      )}
    </DismissibleOverlay>
  )
}
