'use client'

/**
 * @file app-theme-context.tsx
 * @project SlothVault
 * @module Theme Hydration Boundary
 * @description Exposes the server-resolved theme to client components until next-themes has hydrated.
 * @logic Use the cookie-backed initial theme for SSR and the first client render, then switch to the validated resolved theme without a palette flash.
 * @dependencies next-themes, app-theme, use-hydrated
 * @index_tags theme,context,hydration,ssr
 * @author holic512
 */

import { createContext, useContext, type ReactNode } from 'react'

import { useTheme } from 'next-themes'

import { useHydrated } from '@/hooks/use-hydrated'
import { isAppTheme, type AppTheme } from '@/theme/app-theme'

const InitialThemeContext = createContext<AppTheme>('light')

export function AppThemeContextProvider({
  children,
  initialTheme,
}: {
  children: ReactNode
  initialTheme: AppTheme
}) {
  return <InitialThemeContext value={initialTheme}>{children}</InitialThemeContext>
}

export function useResolvedAppTheme(): AppTheme {
  const initialTheme = useContext(InitialThemeContext)
  const { resolvedTheme } = useTheme()
  const hydrated = useHydrated()

  return hydrated && isAppTheme(resolvedTheme) ? resolvedTheme : initialTheme
}
