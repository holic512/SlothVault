'use client'

/**
 * @file design-system-provider.tsx
 * @project SlothVault
 * @module Design System
 * @description Unifies Ant Design, React Query, locale, and the selected visual style.
 * @logic Derive style-aware component tokens from the hydration-safe theme contract, synchronize language, and expose one query client.
 * @dependencies antd, @tanstack/react-query, app-theme-context, app-style-context, next-intl
 * @index_tags provider,antd,react-query,theme,style,locale
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
import { useAppStyle } from '@/components/providers/app-style-context'
import { appThemePalette, standardThemeTokens } from '@/theme/app-theme'

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const resolvedTheme = useResolvedAppTheme()
  const { style } = useAppStyle()
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
  const palette = appThemePalette[style][resolvedTheme]

  useEffect(() => {
    dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en')
    document.documentElement.lang = locale
  }, [locale])

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={locale === 'zh' ? zhCN : enUS}
        theme={{
          cssVar: { key: `slothvault-${style}-${dark ? 'dark' : 'light'}` },
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: palette.primary,
            colorInfo: palette.info,
            colorSuccess: palette.success,
            colorWarning: palette.warning,
            colorError: palette.error,
            borderRadius: 8,
            borderRadiusLG: style === 'saas' ? 14 : 12,
            fontSize: 15,
            fontSizeSM: 13,
            fontSizeHeading1: 'var(--sv-font-page-title)',
            fontSizeHeading2: 'var(--sv-font-reading-h2)',
            fontSizeHeading3: 'var(--sv-font-reading-h3)',
            fontSizeHeading4: 'var(--sv-font-reading-h4)',
            fontSizeHeading5: 'var(--sv-font-reading-h5)',
            lineHeightHeading1: 1.35,
            lineHeightHeading2: 1.35,
            lineHeightHeading3: 1.35,
            lineHeightHeading4: 1.35,
            lineHeightHeading5: 1.35,
            fontFamily: style === 'saas' ? '"Public Sans", sans-serif' : '"Source Sans Pro", "Public Sans", sans-serif',
            colorBgBase: palette.background,
            colorBgContainer: palette.container,
            colorBorder: palette.border,
            controlHeight: style === 'saas' ? 34 : 38,
            ...(style === 'saas' ? standardThemeTokens[resolvedTheme] : {}),
          },
          components: {
            Button: { fontWeight: style === 'saas' ? 600 : 650 },
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
