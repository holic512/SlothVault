'use client'

/**
 * @file design-system-provider.tsx
 * @project SlothVault
 * @module Design System
 * @description Unifies Ant Design, React Query, locale, and the restrained monochrome editorial theme.
 * @logic Derive neutral component tokens from light/dark mode, remove legacy palette classes, synchronize language, and expose one query client.
 * @dependencies antd, @tanstack/react-query, next-themes, next-intl
 * @index_tags provider,antd,react-query,theme,locale,monochrome
 * @author holic512
 */
import { useEffect, useState, type ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { useLocale } from 'next-intl'
import { useTheme } from 'next-themes'

import { useHydrated } from '@/hooks/use-hydrated'

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const mounted = useHydrated()
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  const dark = !mounted || resolvedTheme !== 'light'

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-purple', 'theme-cyan', 'theme-emerald', 'theme-rose')
    root.classList.add('theme-mono')
  }, [])

  useEffect(() => {
    dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en')
    document.documentElement.lang = locale
  }, [locale])

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={locale === 'zh' ? zhCN : enUS}
        theme={{
          cssVar: { key: `slothvault-${dark ? 'dark' : 'light'}-mono` },
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: dark ? '#f1f1ef' : '#141414',
            colorInfo: dark ? '#d7d7d3' : '#2a2a2a',
            colorSuccess: dark ? '#d7d7d3' : '#2a2a2a',
            colorWarning: dark ? '#b8b8b2' : '#575757',
            colorError: dark ? '#d98b8b' : '#8f3030',
            borderRadius: 8,
            borderRadiusLG: 12,
            fontFamily: '"Source Sans Pro", "Public Sans", sans-serif',
            colorBgBase: dark ? '#0d0d0d' : '#f4f3ef',
            colorBgContainer: dark ? '#141414' : '#fbfaf7',
            colorBorder: dark ? 'rgba(255,255,255,.14)' : 'rgba(20,20,20,.16)',
            controlHeight: 38,
          },
          components: {
            Button: { fontWeight: 650 },
            Card: { headerFontSize: 15 },
            Layout: {
              bodyBg: 'transparent',
              headerBg: 'transparent',
              siderBg: dark ? '#101010' : '#f8f7f3',
            },
            Menu: {
              darkItemBg: 'transparent',
              darkSubMenuItemBg: 'transparent',
              itemBorderRadius: 10,
            },
            Table: { headerBg: dark ? '#1a1a1a' : '#efeee9' },
          },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
