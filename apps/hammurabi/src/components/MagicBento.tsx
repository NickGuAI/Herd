/*
 * Adapted from react-bits MagicBento:
 * https://github.com/DavidHDev/react-bits/blob/main/src/content/Components/MagicBento/MagicBento.jsx
 *
 * License: MIT + Commons Clause License Condition v1.0
 * Copyright (c) 2026 David Haz
 *
 * Local modifications:
 * - Converted to TypeScript.
 * - Replaced colorful glow and particles with Sumi-e ink-wash spotlight.
 * - Exposed a child-driven bento API for application settings cards.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import './MagicBento.css'

type BentoStyle = CSSProperties & Record<`--${string}`, string | number | undefined>

export type MagicBentoSpan = 3 | 4 | 6 | 8 | 9 | 12

export interface MagicBentoProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  disableAnimations?: boolean
  enableSpotlight?: boolean
  enableTilt?: boolean
}

export interface MagicBentoCardProps extends HTMLAttributes<HTMLDivElement> {
  span?: MagicBentoSpan
  disableAnimations?: boolean
  enableSpotlight?: boolean
  enableTilt?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) {
      return
    }

    setPrefersReducedMotion(query.matches)
    const handleChange = () => setPrefersReducedMotion(query.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}

function setPointerVars(element: HTMLElement, event: PointerEvent<HTMLDivElement>, enableTilt: boolean) {
  const rect = element.getBoundingClientRect()
  const x = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100)
  const y = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100, 0, 100)

  element.style.setProperty('--bento-x', `${x}%`)
  element.style.setProperty('--bento-y', `${y}%`)
  element.style.setProperty('--bento-spotlight', '1')

  if (enableTilt) {
    const rotateX = ((y - 50) / 50) * -6
    const rotateY = ((x - 50) / 50) * 6
    element.style.setProperty('--bento-rotate-x', `${rotateX.toFixed(3)}deg`)
    element.style.setProperty('--bento-rotate-y', `${rotateY.toFixed(3)}deg`)
  }
}

function resetPointerVars(element: HTMLElement) {
  element.style.setProperty('--bento-x', '50%')
  element.style.setProperty('--bento-y', '50%')
  element.style.setProperty('--bento-spotlight', '0')
  element.style.setProperty('--bento-rotate-x', '0deg')
  element.style.setProperty('--bento-rotate-y', '0deg')
}

export function MagicBentoCard({
  span = 6,
  children,
  className,
  style,
  disableAnimations = false,
  enableSpotlight = true,
  enableTilt = true,
  onPointerMove,
  onPointerLeave,
  ...props
}: MagicBentoCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const card = cardRef.current
    if (card) {
      resetPointerVars(card)
    }
  }, [])

  const cardStyle: BentoStyle = {
    '--bento-span': span,
    ...style,
  }

  return (
    <div
      ref={cardRef}
      {...props}
      data-bento-span={span}
      className={cn(
        'hv-magic-bento-card',
        enableSpotlight && 'hv-magic-bento-card--spotlight',
        enableTilt && !disableAnimations && 'hv-magic-bento-card--tilt',
        className,
      )}
      style={cardStyle}
      onPointerMove={(event) => {
        if (!disableAnimations) {
          setPointerVars(event.currentTarget, event, enableTilt)
        }
        onPointerMove?.(event)
      }}
      onPointerLeave={(event) => {
        if (!disableAnimations) {
          resetPointerVars(event.currentTarget)
        }
        onPointerLeave?.(event)
      }}
    >
      {children}
    </div>
  )
}

export function MagicBento({
  children,
  className,
  disableAnimations = false,
  enableSpotlight = true,
  enableTilt = true,
  ...props
}: MagicBentoProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const shouldDisableAnimations = disableAnimations || prefersReducedMotion

  const decoratedChildren = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== MagicBentoCard) {
      return child
    }

    const card = child as ReactElement<MagicBentoCardProps>
    return cloneElement(card, {
      disableAnimations: card.props.disableAnimations ?? shouldDisableAnimations,
      enableSpotlight: card.props.enableSpotlight ?? enableSpotlight,
      enableTilt: card.props.enableTilt ?? enableTilt,
    })
  })

  return (
    <div
      {...props}
      className={cn('hv-magic-bento', className)}
    >
      {decoratedChildren}
    </div>
  )
}

export default MagicBento
