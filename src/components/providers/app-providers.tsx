'use client'

/**
 * @file app-providers.tsx
 * @project SlothVault
 * @module Application Providers
 * @description Defines the client-side provider boundary shared by every Next.js page.
 * @logic Apply persistent mode first, then design/query context, and finally the browser-only wallet runtime.
 * @dependencies next-themes, design-system-provider, wallet-runtime
 * @index_tags providers,application,theme,wallet
 * @author holic512
 */
import type { ReactNode } from 'react'

import { ThemeProvider } from 'next-themes'

import { DesignSystemProvider } from '@/components/providers/design-system-provider'
import { WalletRuntime } from '@/components/providers/wallet-runtime'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <DesignSystemProvider>
        <WalletRuntime>{children}</WalletRuntime>
      </DesignSystemProvider>
    </ThemeProvider>
  )
}
