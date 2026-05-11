import { X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import type { WorkspaceFilePreview as WorkspaceFilePreviewData } from '../../../workspace/types'
import { WorkspaceFilePreview } from '../../../workspace/components/WorkspaceFilePreview'

interface PreviewPopupProps {
  open: boolean
  selectedPath: string | null
  preview: WorkspaceFilePreviewData | null
  draftContent: string
  loading: boolean
  error: string | null
  onClose: () => void
}

export function PreviewPopup({
  open,
  selectedPath,
  preview,
  draftContent,
  loading,
  error,
  onClose,
}: PreviewPopupProps) {
  if (!open || !selectedPath) {
    return null
  }

  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title="Workspace file preview"
      position="modal"
      containerClassName="z-[10000]"
      backdropClassName="bg-sumi-black/30 md:bg-sumi-black/15"
      contentClassName="contents"
      contentProps={{ role: 'presentation' }}
    >
      <div className="hidden w-full max-w-5xl md:flex">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Workspace file preview"
          className="flex h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-ink-border bg-washi-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
            <span className="font-mono text-xs text-sumi-gray">Preview</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-sumi-diluted transition-colors hover:bg-ink-wash"
              aria-label="Close preview"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 flex flex-col p-3">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly
            />
          </div>
        </div>
      </div>

      <div className="w-full px-2 pb-2 pt-8 md:hidden">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Workspace file preview"
          className="flex max-h-[90dvh] min-h-[50dvh] flex-col overflow-hidden rounded-2xl border border-ink-border bg-washi-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
            <span className="font-mono text-xs text-sumi-gray">Preview</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-sumi-diluted transition-colors hover:bg-ink-wash"
              aria-label="Close preview"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 flex flex-col p-2">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly
            />
          </div>
        </div>
      </div>
    </DismissibleOverlay>
  )
}
