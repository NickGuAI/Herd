import { Download, Loader2, X } from 'lucide-react'
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
  downloading?: boolean
  downloadError?: string | null
  onClose: () => void
  onDownload?: () => void
}

export function PreviewPopup({
  open,
  selectedPath,
  preview,
  draftContent,
  loading,
  error,
  downloading = false,
  downloadError = null,
  onClose,
  onDownload,
}: PreviewPopupProps) {
  if (!open || !selectedPath) {
    return null
  }

  function renderHeader() {
    return (
      <>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs text-[color:var(--hv-fg-muted)]">
            {selectedPath}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading || loading}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 text-xs text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Download ${selectedPath}`}
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              <span className="hidden sm:inline">Download</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[color:var(--hv-fg-subtle)] transition-colors hover:bg-[var(--hv-surface-hover)]"
            aria-label="Close preview"
          >
            <X size={14} />
          </button>
        </div>
      </>
    )
  }

  function renderDownloadErrorBanner() {
    return downloadError ? (
      <div className="border-b border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
        {downloadError}
      </div>
    ) : null
  }

  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title="Workspace file preview"
      position="modal"
      containerClassName="z-[10000]"
      backdropClassName="bg-[var(--hv-button-primary-bg)] md:bg-[var(--hv-button-primary-bg)]"
      contentClassName="contents"
      contentProps={{ role: 'presentation' }}
    >
      <div className="hidden w-full max-w-5xl md:flex">
        <div
          data-testid="workspace-preview-desktop-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace file preview"
          className="flex h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] px-3 py-2">
            {renderHeader()}
          </div>
          {renderDownloadErrorBanner()}
          <div data-testid="workspace-preview-desktop-body" className="min-h-0 flex-1 flex flex-col p-3">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly
              showHeader={false}
            />
          </div>
        </div>
      </div>

      <div
        data-testid="workspace-preview-mobile-shell"
        className="h-[100dvh] w-full max-w-full [--safe-bottom:env(safe-area-inset-bottom,0px)] [--safe-top:env(safe-area-inset-top,0px)] md:hidden"
      >
        <div
          data-testid="workspace-preview-mobile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace file preview"
          className="flex h-full w-full max-w-full flex-col overflow-hidden bg-[var(--hv-surface-card)]"
        >
          <div
            data-testid="workspace-preview-mobile-header"
            className="flex min-w-0 items-center justify-between gap-2 border-b border-[color:var(--hv-border-hair)] px-3 pb-2 pt-[calc(0.5rem+var(--safe-top))]"
          >
            {renderHeader()}
          </div>
          {renderDownloadErrorBanner()}
          <div data-testid="workspace-preview-mobile-body" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[var(--safe-bottom)]">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly
              showHeader={false}
            />
          </div>
        </div>
      </div>
    </DismissibleOverlay>
  )
}
