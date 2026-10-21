'use client'

/**
 * @file app-theme-context.tsx
 * @project SlothVault
 * @module Theme Hydration Boundary
 * @description Owns the cookie-seeded application color mode for client components without injecting a runtime script.
 * @logic Hydrate from the server theme, commit document and React colors together, and reveal explicit changes from their interaction origin with accessible fallbacks.
 * @dependencies React Context, react-dom, app-theme, theme-transition
 * @index_tags theme,context,hydration,ssr
 * @author holic512
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { flushSync } from 'react-dom'

import type { AppTheme } from '@/theme/app-theme'
import { createThemeTransition, type ThemeTransitionOrigin } from '@/theme/theme-transition'

type AppThemeContextValue = {
  theme: AppTheme
  setTheme: (theme: AppTheme, origin?: ThemeTransitionOrigin) => void
}

const AppThemeContext = createContext<AppThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
})

function applyThemeClass(theme: AppTheme) {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
}

export function AppThemeContextProvider({
  children,
  initialTheme,
}: {
  children: ReactNode
  initialTheme: AppTheme
}) {
  const [theme, setThemeState] = useState(initialTheme)

  const [transition] = useState(() => createThemeTransition(initialTheme, (nextTheme) => {
    flushSync(() => {
      setThemeState(nextTheme)
      applyThemeClass(nextTheme)
    })
  }))

  useEffect(() => () => transition.cancel(), [transition])

  const setTheme = useCallback((nextTheme: AppTheme, origin?: ThemeTransitionOrigin) => {
    transition.setTheme(nextTheme, origin)
  }, [transition])

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme])
  return <AppThemeContext value={value}>{children}</AppThemeContext>
}

export function useAppTheme() {
  return useContext(AppThemeContext)
}

export function useResolvedAppTheme(): AppTheme {
  return useAppTheme().theme
}
