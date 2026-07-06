import { useEffect, useState } from 'react'
import { Download, Loader2, MessageSquarePlus, RefreshCw, Save, X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import type { WorkspaceFilePreview as WorkspaceFilePreviewData } from '../types'
import type { WorkspacePendingFileAnnotation } from '../use-workspace'
import { WorkspaceFilePreview } from './WorkspaceFilePreview'

interface WorkspaceFilePreviewModalProps {
  open: boolean
  selectedPath: string | null
  preview: WorkspaceFilePreviewData | null
  draftContent: string
  loading: boolean
  refreshing?: boolean
  error: string | null
  readOnly?: boolean
  saving?: boolean
  downloading?: boolean
  downloadError?: string | null
  onClose: () => void
  onRefresh?: () => void
  onDownload?: () => void
  onInsertPath?: (path: string, type: 'file') => void
  onAddAnnotationContext?: (annotation: WorkspacePendingFileAnnotation) => void
  onDraftChange?: (value: string) => void
  onSave?: () => void
}

export function WorkspaceFilePreviewModal({
  open,
  selectedPath,
  preview,
  draftContent,
  loading,
  refreshing = false,
  error,
  readOnly = false,
  saving = false,
  downloading = false,
  downloadError = null,
  onClose,
  onRefresh,
  onDownload,
  onInsertPath,
  onAddAnnotationContext,
  onDraftChange,
  onSave,
}: WorkspaceFilePreviewModalProps) {
  const [mode, setMode] = useState<'preview' | 'editor'>('preview')
  const [annotationText, setAnnotationText] = useState('')
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [mobileAnnotationsOpen, setMobileAnnotationsOpen] = useState(false)
  const canEdit = preview?.kind === 'text' && !readOnly
  const annotationPath = preview?.path ?? selectedPath

  useEffect(() => {
    if (open) {
      setMode('preview')
      setAnnotationText('')
      setAnnotationError(null)
      setMobileAnnotationsOpen(false)
    }
  }, [open, selectedPath])

  function handleAddAnnotation(): boolean {
    const body = annotationText.trim()
    if (!body || !annotationPath) {
      return false
    }
    if (!onAddAnnotationContext) {
      setAnnotationError('No active composer is available for this annotation')
      return false
    }
    setAnnotationError(null)
    onAddAnnotationContext({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${annotationPath}:${Date.now()}`,
      path: annotationPath,
      body,
      quote: null,
      range: null,
    })
    setAnnotationText('')
    return true
  }

  function handleAddMobileAnnotation(): void {
    if (handleAddAnnotation()) {
      setMobileAnnotationsOpen(false)
    }
  }

  function renderAnnotationControls(surface: 'desktop' | 'mobile') {
    return (
      <>
        <textarea
          data-testid={`workspace-file-preview-${surface}-annotation-input`}
          className="min-h-[88px] w-full resize-none rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2 text-sm text-[color:var(--hv-fg)] outline-none placeholder:text-[color:var(--hv-fg-faint)] focus:border-[color:var(--hv-border-strong)]"
          placeholder="Annotation..."
          value={annotationText}
          onChange={(event) => setAnnotationText(event.target.value)}
        />
        {annotationError && (
          <p className="mt-2 text-xs text-[color:var(--hv-accent-danger)]">
            {annotationError}
          </p>
        )}
        <button
          type="button"
          data-testid={`workspace-file-preview-${surface}-annotation-submit`}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-3 py-2 text-xs font-medium text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!annotationText.trim() || !onAddAnnotationContext}
          onClick={surface === 'mobile' ? handleAddMobileAnnotation : handleAddAnnotation}
        >
          <MessageSquarePlus size={13} />
          Add annotation
        </button>
      </>
    )
  }

  if (!open || !selectedPath) {
    return null
  }

  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title="Workspace file"
      position="modal"
      contentClassName="contents"
      contentProps={{ role: 'presentation' }}
    >
      <div
        data-testid="workspace-file-preview-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace file"
        className="flex h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-[var(--hv-surface-card)] [--safe-bottom:env(safe-area-inset-bottom,0px)] [--safe-top:env(safe-area-inset-top,0px)] md:h-[92dvh] md:max-w-[min(1200px,96vw)] md:rounded-xl md:border md:border-[color:var(--hv-border-hair)] md:shadow-2xl"
      >
        <div
          data-testid="workspace-file-preview-modal-header"
          className="flex min-w-0 items-center justify-between gap-2 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 pb-2 pt-[calc(0.75rem+var(--safe-top))] md:gap-3 md:px-4 md:py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">
              Current content on disk
            </p>
            <p className="truncate font-mono text-sm text-[color:var(--hv-fg)]">
              {selectedPath}
            </p>
            {preview && (
              <p className="text-whisper text-[color:var(--hv-fg-subtle)]">
                {preview.kind} • {preview.size} bytes
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onDownload && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onDownload}
                disabled={downloading || loading}
                aria-label={`Download ${selectedPath}`}
              >
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                <span className="hidden sm:inline">Download</span>
              </button>
            )}
            {preview && onInsertPath && (
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-xs text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]"
                onClick={() => onInsertPath(preview.path, 'file')}
                aria-label={`Add ${preview.path} to context`}
              >
                <MessageSquarePlus size={13} className="sm:hidden" />
                <span className="hidden sm:inline">Add to context</span>
              </button>
            )}
            {canEdit && (
              <div className="inline-flex rounded-md border border-[color:var(--hv-border-hair)] p-0.5">
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${mode === 'preview' ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]' : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]'}`}
                  onClick={() => setMode('preview')}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${mode === 'editor' ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]' : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]'}`}
                  onClick={() => setMode('editor')}
                >
                  Edit
                </button>
              </div>
            )}
            {canEdit && mode === 'editor' && onSave && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
                onClick={onSave}
                disabled={saving}
                aria-label={`Save ${selectedPath}`}
                title="Save file"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span className="hidden sm:inline">Save</span>
              </button>
            )}
            <button
              type="button"
              data-testid="workspace-file-preview-mobile-annotation-button"
              className="inline-flex items-center rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)] md:hidden"
              onClick={() => setMobileAnnotationsOpen(true)}
              aria-label="Open context annotation"
              title="Context annotation"
            >
              <MessageSquarePlus size={13} />
            </button>
            {onRefresh && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="Refresh file preview"
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]"
              onClick={onClose}
              aria-label="Close file preview"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        {downloadError && (
          <div className="border-b border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-2 text-sm text-[color:var(--hv-accent-danger)]">
            {downloadError}
          </div>
        )}
        <div data-testid="workspace-file-preview-modal-body" className="relative flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0 pb-[var(--safe-bottom)] md:gap-4 md:overflow-visible md:p-4 lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly={readOnly}
              saving={saving}
              displayMode={mode}
              showHeader={false}
              showTextActions={false}
              onDraftChange={onDraftChange}
              onSave={onSave}
            />
          </div>
          {mobileAnnotationsOpen && (
            <div data-testid="workspace-file-preview-mobile-annotation-sheet" className="absolute inset-0 z-20 md:hidden">
              <button
                type="button"
                className="absolute inset-0 h-full w-full bg-[var(--hv-bg-overlay)]"
                onClick={() => setMobileAnnotationsOpen(false)}
                aria-label="Close context annotation"
              />
              <div
                role="dialog"
                aria-label="Context annotation"
                className="absolute inset-x-0 bottom-0 flex max-h-[min(70dvh,520px)] flex-col overflow-hidden rounded-t-xl border-t border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] shadow-2xl"
              >
                <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--hv-fg)]">
                    <MessageSquarePlus size={14} className="shrink-0 text-[color:var(--hv-fg-subtle)]" />
                    <span className="truncate">Context annotation</span>
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]"
                    onClick={() => setMobileAnnotationsOpen(false)}
                    aria-label="Close context annotation"
                    title="Close context annotation"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="min-h-0 overflow-y-auto p-3 pb-[calc(0.75rem+var(--safe-bottom))]">
                  {renderAnnotationControls('mobile')}
                </div>
              </div>
            </div>
          )}
          <aside data-testid="workspace-file-preview-desktop-annotation-aside" className="hidden min-h-[220px] w-full flex-col rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] md:flex lg:w-[340px]">
            <div className="border-b border-[color:var(--hv-border-hair)] px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--hv-fg)]">
                <MessageSquarePlus size={14} className="text-[color:var(--hv-fg-subtle)]" />
                Context annotation
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col justify-between p-3">
              {renderAnnotationControls('desktop')}
            </div>
          </aside>
        </div>
      </div>
    </DismissibleOverlay>
  )
}
