'use client'

/**
 * @file app-theme-context.tsx
 * @project SlothVault
 * @module Theme Hydration Boundary
 * @description Owns the cookie-seeded application color mode for client components without injecting a runtime script.
 * @logic Start from the server-resolved theme, synchronize explicit color-mode changes to the document class, and expose a single validated theme state to client consumers.
 * @dependencies React Context, app-theme
 * @index_tags theme,context,hydration,ssr
 * @author holic512
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { AppTheme } from '@/theme/app-theme'

type AppThemeContextValue = {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
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

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setThemeState(nextTheme)
    applyThemeClass(nextTheme)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme])
  return <AppThemeContext value={value}>{children}</AppThemeContext>
}

export function useAppTheme() {
  return useContext(AppThemeContext)
}

export function useResolvedAppTheme(): AppTheme {
  return useAppTheme().theme
}
