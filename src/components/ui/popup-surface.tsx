'use client'

import type { ReactNode } from 'react'

import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import { LiquidGlassCard } from '@/components/ui/liquid-glass-card'

/** Stable popup content with the same persisted surface choice as navigation and cards. */
export function PopupSurface({ children, className = '', padding = 8 }: {
  children: ReactNode
  className?: string
  padding?: number
}) {
  const { publicNavStyle } = usePublicNavStyle()
  return (
    <LiquidGlassCard
      enabled={publicNavStyle === 'liquid-glass'}
      className={`nav-popup-surface ${className}`}
      padding={padding}
      outerRadius={18}
      refraction={8}
      blur={1}
    >
      {children}
    </LiquidGlassCard>
  )
}
