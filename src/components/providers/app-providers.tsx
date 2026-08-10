'use client'

/**
 * @file app-providers.tsx
 * @project SlothVault
 * @module Application Providers
 * @description Defines the client-side provider boundary shared by every Next.js page.
 * @logic Apply the SSR color mode and visual style, then design/query context, and finally the browser-only wallet runtime used only by optional login and copyright minting.
 * @dependencies next-themes, app-style-context, design-system-provider, wallet-runtime
 * @index_tags providers,application,theme,style,wallet
 * @author holic512
 */
import type { ReactNode } from 'react'

import { ThemeProvider } from 'next-themes'

import { AppStyleContextProvider } from '@/components/providers/app-style-context'
import { AppThemeContextProvider } from '@/components/providers/app-theme-context'
import { DesignSystemProvider } from '@/components/providers/design-system-provider'
import { WalletRuntime } from '@/components/providers/wallet-runtime'
import type { AppTheme } from '@/theme/app-theme'
import type { AppStyle } from '@/theme/app-style'

export function AppProviders({
  children,
  initialTheme,
  initialStyle,
}: {
  children: ReactNode
  initialTheme: AppTheme
  initialStyle: AppStyle
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme={initialTheme} enableSystem={false} disableTransitionOnChange>
      <AppStyleContextProvider initialStyle={initialStyle}>
        <AppThemeContextProvider initialTheme={initialTheme}>
          <DesignSystemProvider>
            <WalletRuntime>{children}</WalletRuntime>
          </DesignSystemProvider>
        </AppThemeContextProvider>
      </AppStyleContextProvider>
    </ThemeProvider>
  )
}
