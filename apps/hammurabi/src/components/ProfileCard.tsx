/*
 * Adapted from react-bits ProfileCard:
 * https://github.com/DavidHDev/react-bits/blob/main/src/content/Components/ProfileCard/ProfileCard.jsx
 *
 * License: MIT + Commons Clause License Condition v1.0
 * Copyright (c) 2026 David Haz
 *
 * Local modifications:
 * - Converted to TypeScript.
 * - Replaced holographic shine with sumi-e paper and ink-wash layers.
 * - Exposed a button-shaped card API for in-app selection.
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import './ProfileCard.css'

type ProfileCardStyle = CSSProperties & Record<`--${string}`, string | number | undefined>

export interface ProfileCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  avatarUrl?: string | null
  miniAvatarUrl?: string | null
  grainUrl?: string
  innerGradient?: string
  behindGlowEnabled?: boolean
  behindGlowColor?: string
  behindGlowSize?: string
  enableTilt?: boolean
  name: string
  title?: string
  handle?: string
  status?: string
  statusAdornment?: ReactNode
  showUserInfo?: boolean
}

const DEFAULT_INNER_GRADIENT = 'linear-gradient(145deg,var(--hv-surface-card) 0%,var(--hv-bg-raised) 100%)'
const DEFAULT_BEHIND_GLOW_COLOR = 'var(--hv-ink-wash-03)'
const DEFAULT_BEHIND_GLOW_SIZE = '64%'

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max)
}

function round(value: number, precision = 3): number {
  return Number.parseFloat(value.toFixed(precision))
}

function setPointerVars(element: HTMLElement, x: number, y: number) {
  const width = element.clientWidth || 1
  const height = element.clientHeight || 1
  const percentX = clamp((100 / width) * x)
  const percentY = clamp((100 / height) * y)
  const centerX = percentX - 50
  const centerY = percentY - 50

  element.style.setProperty('--pointer-x', `${percentX}%`)
  element.style.setProperty('--pointer-y', `${percentY}%`)
  element.style.setProperty('--pointer-from-center', `${clamp(Math.hypot(percentY - 50, percentX - 50) / 50, 0, 1)}`)
  element.style.setProperty('--pointer-from-top', `${percentY / 100}`)
  element.style.setProperty('--pointer-from-left', `${percentX / 100}`)
  element.style.setProperty('--rotate-x', `${round(centerX / 8)}deg`)
  element.style.setProperty('--rotate-y', `${round(-(centerY / 8))}deg`)
}

function centerPointerVars(element: HTMLElement) {
  setPointerVars(element, element.clientWidth / 2, element.clientHeight / 2)
}

export const ProfileCard = memo(function ProfileCard({
  avatarUrl,
  miniAvatarUrl,
  grainUrl = '',
  innerGradient = DEFAULT_INNER_GRADIENT,
  behindGlowEnabled = true,
  behindGlowColor = DEFAULT_BEHIND_GLOW_COLOR,
  behindGlowSize = DEFAULT_BEHIND_GLOW_SIZE,
  enableTilt = true,
  name,
  title = 'Commander',
  handle,
  status,
  statusAdornment,
  showUserInfo = true,
  className,
  style,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  ...buttonProps
}: ProfileCardProps) {
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const shellRef = useRef<HTMLButtonElement | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [miniImageFailed, setMiniImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [avatarUrl])

  useEffect(() => {
    setMiniImageFailed(false)
  }, [miniAvatarUrl])

  useEffect(() => {
    const shell = shellRef.current
    if (shell) {
      centerPointerVars(shell)
    }
  }, [])

  const activate = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enableTilt) {
      return
    }
    const shell = event.currentTarget
    const rect = shell.getBoundingClientRect()
    setPointerVars(shell, event.clientX - rect.left, event.clientY - rect.top)
    shell.classList.add('active')
    wrapRef.current?.classList.add('active')
  }, [enableTilt])

  const move = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enableTilt) {
      return
    }
    const shell = event.currentTarget
    const rect = shell.getBoundingClientRect()
    setPointerVars(shell, event.clientX - rect.left, event.clientY - rect.top)
  }, [enableTilt])

  const deactivate = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (enableTilt) {
      centerPointerVars(event.currentTarget)
    }
    event.currentTarget.classList.remove('active')
    wrapRef.current?.classList.remove('active')
  }, [enableTilt])

  const cardStyle: ProfileCardStyle = {
    '--inner-gradient': innerGradient,
    '--behind-glow-color': behindGlowColor,
    '--behind-glow-size': behindGlowSize,
    '--grain': grainUrl ? `url(${grainUrl})` : 'none',
    ...style,
  }

  const displayMiniAvatar = miniAvatarUrl && !miniImageFailed
  const hasAvatarUrl = Boolean(avatarUrl)
  const displayAvatar = avatarUrl && !imageFailed
  const buttonAriaLabel = buttonProps['aria-label'] ?? `${name}, ${title}`

  return (
    <span
      ref={wrapRef}
      className="hv-profile-card-wrapper"
    >
      {behindGlowEnabled ? <span className="hv-profile-card-behind" aria-hidden="true" /> : null}
      <button
        ref={shellRef}
        type="button"
        {...buttonProps}
        onPointerEnter={(event) => {
          activate(event)
          onPointerEnter?.(event)
        }}
        onPointerMove={(event) => {
          move(event)
          onPointerMove?.(event)
        }}
        onPointerLeave={(event) => {
          deactivate(event)
          onPointerLeave?.(event)
        }}
        className={cn('hv-profile-card-shell', className)}
        style={cardStyle}
        aria-label={buttonAriaLabel}
      >
        <span className="hv-profile-card">
          <span className="hv-profile-card-inside" aria-hidden="true" />
          <span className="hv-profile-card-grain" aria-hidden="true" />
          <span className="hv-profile-card-wash" aria-hidden="true" />

          <span className="hv-profile-card-portrait" aria-hidden="true">
            {displayAvatar ? (
              <img
                src={avatarUrl}
                alt=""
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span className="hv-profile-card-portrait-fallback" />
            )}
          </span>

          {!hasAvatarUrl ? (
            <span className="hv-profile-card-details">
              <span className="hv-profile-card-name">{name}</span>
              <span className="hv-profile-card-title">{title}</span>
            </span>
          ) : null}

          {showUserInfo ? (
            <span className="hv-profile-card-user-info">
              <span className="hv-profile-card-user-details">
                <span className="hv-profile-card-mini-avatar" aria-hidden="true">
                  {displayMiniAvatar ? (
                    <img
                      src={miniAvatarUrl}
                      alt=""
                      loading="lazy"
                      onError={() => setMiniImageFailed(true)}
                    />
                  ) : (
                    <span />
                  )}
                </span>
                <span className="hv-profile-card-user-text">
                  {handle ? <span className="hv-profile-card-handle">{handle}</span> : null}
                  {status ? (
                    <span className="hv-profile-card-status">
                      {statusAdornment ? <span className="hv-profile-card-status-dot">{statusAdornment}</span> : null}
                      <span>{status}</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </span>
          ) : null}
        </span>
      </button>
    </span>
  )
})

export default ProfileCard
