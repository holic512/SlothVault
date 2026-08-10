'use client'

/**
 * @file app-style-context.tsx
 * @project SlothVault
 * @module Style Hydration Boundary
 * @description Exposes the server-resolved visual style and synchronizes the document style attribute after client changes.
 * @logic Start from the SSR style, apply style changes optimistically to the document, and leave persistence to the preferences API.
 * @dependencies react, app-style
 * @index_tags style,context,hydration,ssr
 * @author holic512
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { AppStyle } from '@/theme/app-style'

type AppStyleContextValue = {
  style: AppStyle
  setStyle: (style: AppStyle) => void
}

const AppStyleContext = createContext<AppStyleContextValue | null>(null)

export function AppStyleContextProvider({
  children,
  initialStyle,
}: {
  children: ReactNode
  initialStyle: AppStyle
}) {
  const [style, setStyle] = useState<AppStyle>(initialStyle)

  useEffect(() => {
    document.documentElement.dataset.style = style
  }, [style])

  const value = useMemo(() => ({ style, setStyle }), [style])

  return <AppStyleContext value={value}>{children}</AppStyleContext>
}

export function useAppStyle() {
  const context = useContext(AppStyleContext)
  if (!context) throw new Error('useAppStyle must be used within AppStyleContextProvider')
  return context
}
