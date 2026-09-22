'use client'

/**
 * @file public-nav-style-context.tsx
 * @project SlothVault
 * @module Public Navigation Appearance Boundary
 * @description Shares server-resolved navigation and account-card appearance with serialized optimistic persistence.
 * @logic Seed from SSR, update all surfaces without remounting content, persist the cookie, and roll back on failure.
 * @dependencies React, public-nav-style, preferences API
 * @index_tags provider,public-nav,appearance,liquid-glass,ssr
 * @author holic512
 */

import { createContext, useContext, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'

import { apiFetch } from '@/lib/api-client'
import type { PublicNavStyle } from '@/theme/public-nav-style'

type PublicNavStyleContextValue = {
  publicNavStyle: PublicNavStyle
  changingPublicNavStyle: boolean
  changePublicNavStyle: (style: PublicNavStyle) => Promise<void>
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
  const [changingPublicNavStyle, setChanging] = useState(false)
  const saving = useRef(false)
  const changePublicNavStyle = useCallback(async (next: PublicNavStyle) => {
    if (saving.current || next === publicNavStyle) return
    const previous = publicNavStyle
    saving.current = true
    setChanging(true)
    setPublicNavStyle(next)
    try {
      await apiFetch('/api/preferences/public-nav-style', {
        method: 'POST', body: JSON.stringify({ publicNavStyle: next }),
      })
    } catch (error) {
      setPublicNavStyle(previous)
      throw error
    } finally {
      saving.current = false
      setChanging(false)
    }
  }, [publicNavStyle])
  const value = useMemo(() => ({ publicNavStyle, changingPublicNavStyle, changePublicNavStyle }), [publicNavStyle, changingPublicNavStyle, changePublicNavStyle])

  return <PublicNavStyleContext value={value}>{children}</PublicNavStyleContext>
}

export function usePublicNavStyle() {
  const context = useContext(PublicNavStyleContext)
  if (!context) throw new Error('usePublicNavStyle must be used within PublicNavStyleContextProvider')
  return context
}
