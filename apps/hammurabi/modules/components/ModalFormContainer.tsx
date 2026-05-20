import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { getHervaldThemeClassName, useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

interface ModalFormContainerProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  contentClassName?: string
  mobileClassName?: string
  desktopClassName?: string
}

export function ModalFormContainer({
  open,
  title,
  onClose,
  children,
  contentClassName,
  mobileClassName,
  desktopClassName,
}: ModalFormContainerProps) {
  const { theme } = useTheme()
  const themeClassName = getHervaldThemeClassName(theme)

  return (
    <DismissibleOverlay
      open={open}
      title={title}
      onClose={onClose}
      position="modal"
      contentClassName="contents"
      contentProps={{ role: 'presentation' }}
    >
      <div className="md:hidden">
        <div
          className={cn('sheet visible', themeClassName, mobileClassName)}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
        >
          <div className="sheet-handle">
            <div className="sheet-handle-bar" />
          </div>
          <div className="px-5 pb-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-display text-heading text-[color:var(--hv-fg)]">{title}</h3>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[color:var(--hv-border-hair)] p-1 text-[color:var(--hv-fg-subtle)] transition-colors hover:border-[color:var(--hv-border-soft)] hover:text-[color:var(--hv-fg)]"
                aria-label={`Close ${title}`}
              >
                <X size={14} />
              </button>
            </div>
            <div className={cn('space-y-3', contentClassName)}>{children}</div>
          </div>
        </div>
      </div>

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'card-sumi hidden w-full max-w-3xl max-h-[85dvh] overflow-y-auto p-5 md:block',
          themeClassName,
          desktopClassName,
          contentClassName,
        )}
        tabIndex={-1}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] pb-3">
          <h3 className="font-display text-heading text-[color:var(--hv-fg)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[color:var(--hv-border-hair)] p-1 text-[color:var(--hv-fg-subtle)] transition-colors hover:border-[color:var(--hv-border-soft)] hover:text-[color:var(--hv-fg)]"
            aria-label={`Close ${title}`}
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </DismissibleOverlay>
  )
}
