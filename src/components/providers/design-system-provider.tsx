'use client'

/**
 * @file design-system-provider.tsx
 * @project SlothVault
 * @module Design System
 * @description Unifies Ant Design, React Query, theme mode, locale, and SlothVault palette tokens.
 * @logic Rehydrate the persisted palette after mount, derive component tokens from the active mode/palette, synchronize root classes, and expose one query client.
 * @dependencies antd, @tanstack/react-query, next-themes, next-intl, stores/preferences
 * @index_tags provider,antd,react-query,theme,locale
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

import { usePreferencesStore, type Palette } from '@/stores/preferences'
import { useHydrated } from '@/hooks/use-hydrated'

const paletteColors: Record<Palette, string> = {
  purple: '#8b5cf6',
  cyan: '#0891b2',
  emerald: '#059669',
  rose: '#e11d48',
}

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const palette = usePreferencesStore((state) => state.palette)
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
    void usePreferencesStore.persist.rehydrate()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-purple', 'theme-cyan', 'theme-emerald', 'theme-rose')
    root.classList.add(`theme-${palette}`)
  }, [palette])

  useEffect(() => {
    dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en')
    document.documentElement.lang = locale
  }, [locale])

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={locale === 'zh' ? zhCN : enUS}
        theme={{
          cssVar: { key: `slothvault-${dark ? 'dark' : 'light'}-${palette}` },
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: paletteColors[palette],
            borderRadius: 12,
            borderRadiusLG: 18,
            fontFamily: '"Public Sans", "Source Sans Pro", sans-serif',
            colorBgBase: dark ? '#08090c' : '#f6f7f9',
            colorBgContainer: dark ? '#111318' : '#ffffff',
            colorBorder: dark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.11)',
            controlHeight: 38,
          },
          components: {
            Button: { fontWeight: 650 },
            Card: { headerFontSize: 15 },
            Layout: {
              bodyBg: 'transparent',
              headerBg: 'transparent',
              siderBg: dark ? '#0d0f13' : '#ffffff',
            },
            Menu: {
              darkItemBg: 'transparent',
              darkSubMenuItemBg: 'transparent',
              itemBorderRadius: 10,
            },
            Table: { headerBg: dark ? '#161920' : '#f3f5f7' },
          },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
