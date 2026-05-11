import { type ReactNode } from 'react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { cn } from '@/lib/utils'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  maxHeight?: string
  position?: 'bottom' | 'top'
  dark?: boolean
}

export default function BottomSheet({
  open,
  onClose,
  children,
  title,
  maxHeight = '85dvh',
  position = 'bottom',
  dark = false,
}: BottomSheetProps) {
  const anchoredToBottom = position === 'bottom'

  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title={title}
      position={anchoredToBottom ? 'bottom-sheet' : 'top-sheet'}
      portalThemeClassName={dark ? 'hv-dark' : undefined}
      contentClassName={cn(
        'flex w-full flex-col overflow-hidden bg-washi-white',
        anchoredToBottom
          ? 'rounded-t-2xl md:max-w-2xl md:rounded-xl'
          : 'rounded-b-2xl md:max-w-2xl md:rounded-xl',
      )}
      contentStyle={{ maxHeight }}
    >
      <div className="flex justify-center pb-1 pt-2">
        <div className="h-1 w-8 rounded-full bg-ink-border" />
      </div>

      {title ? (
        <div className="border-b border-ink-border px-4 pb-3 pt-2">
          <h2 className="font-display text-heading text-sumi-black">{title}</h2>
        </div>
      ) : null}

      {children}
    </DismissibleOverlay>
  )
}
