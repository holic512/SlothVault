'use client'

/**
 * @file design-system-provider.tsx
 * @project SlothVault
 * @module Design System
 * @description Unifies Ant Design, React Query, locale, and the restrained monochrome editorial theme.
 * @logic Derive neutral component tokens from the hydration-safe theme contract, synchronize language, and expose one query client.
 * @dependencies antd, @tanstack/react-query, app-theme-context, next-intl
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

import { useResolvedAppTheme } from '@/components/providers/app-theme-context'
import { appThemePalette } from '@/theme/app-theme'

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const resolvedTheme = useResolvedAppTheme()
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

  const dark = resolvedTheme === 'dark'
  const palette = appThemePalette[resolvedTheme]

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
            colorPrimary: palette.primary,
            colorInfo: palette.info,
            colorSuccess: palette.success,
            colorWarning: palette.warning,
            colorError: palette.error,
            borderRadius: 8,
            borderRadiusLG: 12,
            fontFamily: '"Source Sans Pro", "Public Sans", sans-serif',
            colorBgBase: palette.background,
            colorBgContainer: palette.container,
            colorBorder: palette.border,
            controlHeight: 38,
          },
          components: {
            Button: { fontWeight: 650 },
            Card: { headerFontSize: 15 },
            Layout: {
              bodyBg: 'transparent',
              headerBg: 'transparent',
              siderBg: palette.sider,
            },
            Menu: {
              darkItemBg: 'transparent',
              darkSubMenuItemBg: 'transparent',
              itemBorderRadius: 10,
            },
            Table: { headerBg: palette.tableHeader },
          },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
