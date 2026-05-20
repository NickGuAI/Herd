import { useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  Folder,
  FileText,
  ChevronRight,
  ChevronUp,
  Plus,
  Upload,
  Loader2,
  X,
} from 'lucide-react'
import { useFiles, uploadFiles } from '@/hooks/use-files'
import { cn } from '@/lib/utils'

export function WorkingDirectoryPanel({
  cwd,
  position = 'side',
  onClose,
  onInsertPath,
}: {
  cwd: string
  position?: 'side' | 'compact'
  variant?: 'light' | 'dark'
  onClose?: () => void
  onInsertPath?: (filePath: string) => void
}) {
  const [browsePath, setBrowsePath] = useState(cwd)
  const [isOpen, setIsOpen] = useState(position === 'side')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setBrowsePath(cwd)
  }, [cwd])

  const { data, refetch } = useFiles(browsePath, isOpen)

  async function handleUploadFiles(files: FileList | File[]) {
    if (!files.length) return
    setUploading(true)
    setUploadError(null)
    try {
      await uploadFiles(browsePath, files)
      await refetch()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      void handleUploadFiles(e.target.files)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      void handleUploadFiles(e.dataTransfer.files)
    }
  }

  function getFullPath(name: string) {
    return `${browsePath}/${name}`.replace(/\/+/g, '/')
  }

  function handleItemDragStart(e: React.DragEvent, name: string) {
    const fullPath = getFullPath(name)
    e.dataTransfer.setData('text/plain', fullPath)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleItemClick(name: string, isDirectory: boolean) {
    if (isDirectory) {
      navigateInto(name)
    } else if (onInsertPath) {
      onInsertPath(getFullPath(name))
    }
  }

  function navigateUp() {
    const parent = browsePath.replace(/\/[^/]+$/, '') || '/'
    if (parent.length >= cwd.length) {
      setBrowsePath(parent)
    }
  }

  function navigateInto(dir: string) {
    setBrowsePath(`${browsePath}/${dir}`.replace(/\/+/g, '/'))
  }

  // Compact mode (mobile): collapsible header
  if (position === 'compact') {
    return (
      <div
        className={cn(
          'border-b',
          'border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)]',
          isDragOver && 'ring-2 ring-inset ring-accent-indigo/30',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        >
          <FolderOpen size={14} className="shrink-0 text-[color:var(--hv-fg-subtle)]" />
          <span className="flex-1 truncate font-mono text-xs text-[color:var(--hv-fg-muted)]">{browsePath}</span>
          <ChevronRight
            size={12}
            className={cn(
              'transition-transform duration-200',
              'text-[color:var(--hv-fg-faint)]',
              isOpen && 'rotate-90',
            )}
          />
        </button>
        {isOpen && (
          <div className="px-4 pb-3">
            <div className={cn(
              'rounded-lg border max-h-40 overflow-y-auto',
              'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]',
            )}>
              {data?.files.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs"
                >
                  {f.isDirectory ? (
                    <button
                      onClick={() => handleItemClick(f.name, true)}
                      className="flex flex-1 items-center gap-2 text-left transition-colors hover:text-[color:var(--hv-fg)]"
                    >
                      <Folder size={12} className="shrink-0 text-[color:var(--hv-fg-faint)]" />
                      <span className="font-mono text-[color:var(--hv-fg-muted)]">{f.name}/</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleItemClick(f.name, false)}
                      className="flex flex-1 items-center gap-2 text-left hover:text-[color:var(--hv-fg)]"
                    >
                      <FileText size={12} className="shrink-0 text-[color:var(--hv-fg-faint)]" />
                      <span className="font-mono text-[color:var(--hv-fg-muted)]">{f.name}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={navigateUp}
                disabled={browsePath === cwd}
                className={cn(
                  'p-1.5 rounded border transition-colors disabled:opacity-30',
                  'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] hover:bg-[var(--hv-surface-hover)]',
                )}
                aria-label="Parent directory"
              >
                <ChevronUp size={12} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInput}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border text-xs disabled:opacity-60 transition-colors',
                  'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] hover:bg-[var(--hv-surface-hover)] text-[color:var(--hv-fg-subtle)]',
                )}
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploading ? 'Uploading...' : 'Upload File'}
              </button>
            </div>
            {uploadError && (
              <p className="mt-1 text-xs text-[color:var(--hv-accent-danger)]">{uploadError}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Side panel mode (desktop)
  return (
    <div
      className={cn(
        'w-64 border-l border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] flex flex-col overflow-hidden transition-all duration-300',
        isDragOver && 'ring-2 ring-inset ring-accent-indigo/30 bg-accent-indigo/5',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[color:var(--hv-border-hair)]">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen size={14} className="text-[color:var(--hv-fg-subtle)] shrink-0" />
          <span className="font-mono text-xs text-[color:var(--hv-fg-muted)] truncate">
            {browsePath.split('/').pop() || '/'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={navigateUp}
            disabled={browsePath === cwd}
            className="p-1 rounded hover:bg-[var(--hv-surface-hover)] transition-colors disabled:opacity-30"
            aria-label="Parent directory"
          >
            <ChevronUp size={12} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--hv-surface-hover)] transition-colors"
              aria-label="Close panel"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {data?.files.map((f) => (
          <div
            key={f.name}
            draggable
            onDragStart={(e) => handleItemDragStart(e, f.name)}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--hv-surface-hover)] transition-colors cursor-grab active:cursor-grabbing"
          >
            {f.isDirectory ? (
              <button
                onClick={() => handleItemClick(f.name, true)}
                className="flex items-center gap-2 flex-1 text-left"
              >
                <Folder size={13} className="text-[color:var(--hv-fg-faint)] shrink-0" />
                <span className="font-mono text-xs text-[color:var(--hv-fg)] truncate">{f.name}</span>
              </button>
            ) : (
              <button
                onClick={() => handleItemClick(f.name, false)}
                className="flex items-center gap-2 flex-1 text-left min-w-0"
              >
                <FileText size={13} className="text-[color:var(--hv-fg-faint)] shrink-0" />
                <span className="font-mono text-xs text-[color:var(--hv-fg-muted)] truncate">{f.name}</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Upload area */}
      <div className="border-t border-[color:var(--hv-border-hair)] p-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] hover:bg-[var(--hv-surface-hover)] transition-colors text-xs text-[color:var(--hv-fg-subtle)] disabled:opacity-60"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {uploading ? 'Uploading...' : 'Upload or Drop Files'}
        </button>
        {uploadError && (
          <p className="mt-1 text-xs text-[color:var(--hv-accent-danger)]">{uploadError}</p>
        )}
        {isDragOver && (
          <div className="mt-2 text-center text-xs text-accent-indigo font-medium">
            Drop files here
          </div>
        )}
      </div>
    </div>
  )
}
