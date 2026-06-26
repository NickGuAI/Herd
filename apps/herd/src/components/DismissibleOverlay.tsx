import {
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import { getHerdThemeClassName, useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

type OverlayPosition = 'modal' | 'bottom-sheet' | 'top-sheet'

type OverlayContentProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'className' | 'onMouseDown' | 'style'
> & {
  [dataAttribute: `data-${string}`]: unknown
}

export interface DismissibleOverlayProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  position?: OverlayPosition
  dismissible?: boolean
  containerClassName?: string
  backdropClassName?: string
  contentClassName?: string
  contentStyle?: CSSProperties
  contentProps?: OverlayContentProps
  portalThemeClassName?: 'hv-light' | 'hv-dark'
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') {
      return false
    }

    const styles = window.getComputedStyle(element)
    if (styles.visibility === 'hidden' || styles.display === 'none') {
      return false
    }

    return element.getClientRects().length > 0
  })
}

const POSITION_CLASS_NAME: Record<OverlayPosition, string> = {
  modal: 'items-end justify-center p-0 md:items-center md:p-5',
  'bottom-sheet': 'items-end justify-center md:items-center md:p-5',
  'top-sheet': 'items-start justify-center md:items-center md:p-5',
}

export function DismissibleOverlay({
  open,
  onClose,
  children,
  title,
  position = 'modal',
  dismissible = true,
  containerClassName,
  backdropClassName,
  contentClassName,
  contentStyle,
  contentProps,
  portalThemeClassName,
}: DismissibleOverlayProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  const { theme } = useTheme()
  const themeClassName = portalThemeClassName ?? getHerdThemeClassName(theme)

  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }

    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const content = contentRef.current
    if (content) {
      const focusableElements = getFocusableElements(content)
      ;(focusableElements[0] ?? content).focus()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (dismissible) {
          event.preventDefault()
          onCloseRef.current()
        }
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const activeContent = contentRef.current
      const elements = activeContent ? getFocusableElements(activeContent) : []
      if (elements.length === 0) {
        event.preventDefault()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first || !last) {
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousActiveElement?.focus()
    }
  }, [dismissible, open])

  if (!open) {
    return null
  }

  function handleOuterMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (!dismissible || event.target !== event.currentTarget) {
      return
    }

    onCloseRef.current()
  }

  const {
    role = 'dialog',
    tabIndex,
    'aria-label': ariaLabel,
    'aria-modal': ariaModal,
    ...restContentProps
  } = contentProps ?? {}

  const overlay = (
    <div
      data-testid="dismissible-overlay"
      className={cn(
        'fixed inset-0 z-[9999] isolate flex',
        POSITION_CLASS_NAME[position],
        themeClassName,
        containerClassName,
      )}
      onMouseDown={handleOuterMouseDown}
    >
      <div
        className={cn('pointer-events-none absolute inset-0 -z-10 bg-[var(--hv-button-primary-bg)]', backdropClassName)}
        aria-hidden="true"
      />

      <div
        {...restContentProps}
        ref={contentRef}
        role={role}
        aria-modal={ariaModal ?? (role === 'dialog' || role === 'alertdialog' ? true : undefined)}
        aria-label={ariaLabel ?? title}
        tabIndex={tabIndex ?? -1}
        className={contentClassName}
        style={contentStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return overlay
  }

  return createPortal(overlay, document.body)
}
