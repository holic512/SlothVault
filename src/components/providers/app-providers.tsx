'use client'

/**
 * @file app-providers.tsx
 * @project SlothVault
 * @module Application Providers
 * @description Defines the client-side provider boundary shared by every Next.js page.
 * @logic Apply a light editorial mode by default, then design/query context, and finally the browser-only wallet runtime used only by optional login and copyright minting.
 * @dependencies next-themes, design-system-provider, wallet-runtime
 * @index_tags providers,application,theme,wallet
 * @author holic512
 */
import type { ReactNode } from 'react'

import { ThemeProvider } from 'next-themes'

import { AppThemeContextProvider } from '@/components/providers/app-theme-context'
import { DesignSystemProvider } from '@/components/providers/design-system-provider'
import { WalletRuntime } from '@/components/providers/wallet-runtime'
import type { AppTheme } from '@/theme/app-theme'

export function AppProviders({ children, initialTheme }: { children: ReactNode; initialTheme: AppTheme }) {
  return (
    <ThemeProvider attribute="class" defaultTheme={initialTheme} enableSystem={false} disableTransitionOnChange>
      <AppThemeContextProvider initialTheme={initialTheme}>
        <DesignSystemProvider>
          <WalletRuntime>{children}</WalletRuntime>
        </DesignSystemProvider>
      </AppThemeContextProvider>
    </ThemeProvider>
  )
}
