'use client'

/**
 * @file app-providers.tsx
 * @project SlothVault
 * @module Application Providers
 * @description Defines the client-side provider boundary shared by every Next.js page.
 * @logic Apply server-resolved color, visual-style, and public-navigation appearance preferences before exposing shared design and query contexts; wallet runtime is mounted only by wallet-capable routes.
 * @dependencies app-theme-context, app-style-context, public-nav-style-context, design-system-provider
 * @index_tags providers,application,theme,style,public-nav,wallet
 * @author holic512
 */
import type { ReactNode } from 'react'

import { AppStyleContextProvider } from '@/components/providers/app-style-context'
import { AppThemeContextProvider } from '@/components/providers/app-theme-context'
import { DesignSystemProvider } from '@/components/providers/design-system-provider'
import { PublicNavStyleContextProvider } from '@/components/providers/public-nav-style-context'
import type { AppTheme } from '@/theme/app-theme'
import type { AppStyle } from '@/theme/app-style'
import type { PublicNavStyle } from '@/theme/public-nav-style'

export function AppProviders({
  children,
  initialTheme,
  initialStyle,
  initialPublicNavStyle,
}: {
  children: ReactNode
  initialTheme: AppTheme
  initialStyle: AppStyle
  initialPublicNavStyle: PublicNavStyle
}) {
  return (
    <PublicNavStyleContextProvider initialPublicNavStyle={initialPublicNavStyle}>
      <AppStyleContextProvider initialStyle={initialStyle}>
        <AppThemeContextProvider initialTheme={initialTheme}>
          <DesignSystemProvider>{children}</DesignSystemProvider>
        </AppThemeContextProvider>
      </AppStyleContextProvider>
    </PublicNavStyleContextProvider>
  )
}
