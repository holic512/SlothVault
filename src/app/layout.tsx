/**
 * @file layout.tsx
 * @project SlothVault
 * @module Application Shell
 * @description Defines the root Next.js document, metadata, locale provider, Ant Design SSR registry, and client providers.
 * @logic Resolve request preferences and the non-blocking managed favicon on the server, emit a hydration-safe color mode and visual style, and wrap every route once.
 * @dependencies next-intl, @ant-design/nextjs-registry, app-providers, app-style, global styles
 * @index_tags root-layout,metadata,providers,theme,style,ssr
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
import '@uiw/react-md-editor/markdown-editor.css'
import '@uiw/react-markdown-preview/markdown.css'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/shared.css'
import '@/styles/utilities.css'
import '@/styles/vendors.css'

import { AppProviders } from '@/components/providers/app-providers'
import { getSystemBranding } from '@/server/services/system-branding'
import {
  APP_THEME_COOKIE,
  DEFAULT_APP_THEME,
  isAppTheme,
} from '@/theme/app-theme'
import {
  APP_STYLE_COOKIE,
  DEFAULT_APP_STYLE,
  isAppStyle,
} from '@/theme/app-style'

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getSystemBranding()
  return {
    title: {
      default: 'SlothVault',
      template: '%s · SlothVault',
    },
    description: 'A public publishing system for independent articles, versioned projects, accounts, points, contracts, and optional Solana release evidence.',
    icons: { icon: branding.faviconUrl },
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  const messages = await getMessages()
  const cookieStore = await cookies()
  const cookieTheme = cookieStore.get(APP_THEME_COOKIE)?.value
  const cookieStyle = cookieStore.get(APP_STYLE_COOKIE)?.value
  const initialTheme = isAppTheme(cookieTheme) ? cookieTheme : DEFAULT_APP_THEME
  const initialStyle = isAppStyle(cookieStyle) ? cookieStyle : DEFAULT_APP_STYLE

  return (
    <html
      lang={locale}
      className={`theme-${initialStyle} ${initialTheme}`}
      data-style={initialStyle}
      suppressHydrationWarning
    >
      <body>
        <AntdRegistry>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <AppProviders initialTheme={initialTheme} initialStyle={initialStyle}>
              {children}
            </AppProviders>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
