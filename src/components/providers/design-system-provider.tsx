'use client'

/**
 * @file design-system-provider.tsx
 * @project SlothVault
 * @module Design System
 * @description Unifies Ant Design, React Query, locale, and the selected visual style.
 * @logic Derive style-aware component tokens from the hydration-safe theme contract, synchronize language, and expose one query client.
 * @dependencies antd, @tanstack/react-query, app-theme-context, app-style-context, antd-theme, next-intl
 * @index_tags provider,antd,react-query,theme,style,locale
 * @author holic512
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { useLocale } from 'next-intl'

import { useResolvedAppTheme } from '@/components/providers/app-theme-context'
import { useAppStyle } from '@/components/providers/app-style-context'
import { getAntdTheme } from '@/theme/antd-theme'

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
  const componentTheme = useMemo(() => getAntdTheme(style, resolvedTheme), [style, resolvedTheme])

  useEffect(() => {
    dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en')
    document.documentElement.lang = locale
  }, [locale])

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={locale === 'zh' ? zhCN : enUS}
        tag={{ variant: 'outlined' }}
        theme={{
          ...componentTheme,
          cssVar: { key: `slothvault-${style}-${dark ? 'dark' : 'light'}` },
          token: {
            ...componentTheme.token,
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
            controlHeight: style === 'saas' ? 34 : 38,
          },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
