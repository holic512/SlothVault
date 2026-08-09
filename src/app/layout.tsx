/**
 * @file layout.tsx
 * @project SlothVault
 * @module Application Shell
 * @description Defines the root Next.js document, metadata, locale provider, Ant Design SSR registry, and client providers.
 * @logic Resolve request messages on the server, emit a hydration-safe themed document, and wrap every route once.
 * @dependencies next-intl, @ant-design/nextjs-registry, app-providers, global styles
 * @index_tags root-layout,metadata,providers,ssr
 * @author holic512
 */
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

import { AntdRegistry } from '@ant-design/nextjs-registry'

import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/public-sans/700.css'
import '@fontsource/source-sans-pro/400.css'
import '@fontsource/source-sans-pro/600.css'
import '@solana/wallet-adapter-react-ui/styles.css'
import '@uiw/react-md-editor/markdown-editor.css'
import '@uiw/react-markdown-preview/markdown.css'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/shared.css'
import '@/styles/utilities.css'
import '@/styles/vendors.css'

import { AppProviders } from '@/components/providers/app-providers'
import {
  APP_THEME_COOKIE,
  DEFAULT_APP_THEME,
  isAppTheme,
} from '@/theme/app-theme'

export const metadata: Metadata = {
  title: {
    default: 'SlothVault',
    template: '%s · SlothVault',
  },
  description: 'A public Web2 publishing system with personal profiles, points, gift cards, and optional on-chain copyright certificates.',
  icons: { icon: '/favicon.ico' },
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  const messages = await getMessages()
  const cookieStore = await cookies()
  const cookieTheme = cookieStore.get(APP_THEME_COOKIE)?.value
  const initialTheme = isAppTheme(cookieTheme) ? cookieTheme : DEFAULT_APP_THEME

  return (
    <html lang={locale} className={`theme-mono ${initialTheme}`} suppressHydrationWarning>
      <body>
        <AntdRegistry>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <AppProviders initialTheme={initialTheme}>{children}</AppProviders>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
