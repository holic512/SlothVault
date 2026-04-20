import './globals.css'
import 'antd/dist/reset.css'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/source-sans-pro/400.css'
import '@fontsource/source-sans-pro/600.css'
import 'md-editor-rt/lib/style.css'

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'

import { AppProviders } from '@/components/providers/app-providers'
import { getMessages, resolveLocale } from '@/lib/i18n'
import { buildPageTitle } from '@/lib/metadata'
import { ThemeScript } from '@/components/theme/theme-script'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveLocale(await cookies())
  return {
    title: buildPageTitle(locale, 'siteName', undefined, false)
  }
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const locale = await resolveLocale(cookieStore)
  const messages = await getMessages(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeScript />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppProviders locale={locale}>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
