'use client'

/**
 * @file public-nav-style-context.tsx
 * @project SlothVault
 * @module Public Navigation Appearance Boundary
 * @description Exposes the server-resolved public-navigation appearance for optimistic client-side switching.
 * @logic Seed the shared preference from SSR, make the public navbar react immediately, and leave long-term persistence to the preference API.
 * @dependencies React, public-nav-style
 * @index_tags provider,public-nav,appearance,liquid-glass,ssr
 * @author holic512
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { PublicNavStyle } from '@/theme/public-nav-style'

type PublicNavStyleContextValue = {
  publicNavStyle: PublicNavStyle
  setPublicNavStyle: (style: PublicNavStyle) => void
}

const PublicNavStyleContext = createContext<PublicNavStyleContextValue | null>(null)

export function PublicNavStyleContextProvider({
  children,
  initialPublicNavStyle,
}: {
  children: ReactNode
  initialPublicNavStyle: PublicNavStyle
}) {
  const [publicNavStyle, setPublicNavStyle] = useState<PublicNavStyle>(initialPublicNavStyle)
  const value = useMemo(() => ({ publicNavStyle, setPublicNavStyle }), [publicNavStyle])

  return <PublicNavStyleContext value={value}>{children}</PublicNavStyleContext>
}

export function usePublicNavStyle() {
  const context = useContext(PublicNavStyleContext)
  if (!context) throw new Error('usePublicNavStyle must be used within PublicNavStyleContextProvider')
  return context
}
