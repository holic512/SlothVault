'use client'

/**
 * @file theme-controls.tsx
 * @project SlothVault
 * @module Theme and Locale Controls
 * @description Exposes only light/dark mode and language for the monochrome interface.
 * @logic Persist the selected theme through next-themes and update the locale cookie without offering bright palette variants.
 * @dependencies antd, next-themes, next-intl, preferences API
 * @index_tags theme,locale,monochrome,accessibility
 * @author holic512
 */

import { useTransition } from 'react'

import { Button, Divider, Popover, Segmented, Typography } from 'antd'
import { Moon, Sun } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'

import { apiFetch } from '@/lib/api-client'
import { useHydrated } from '@/hooks/use-hydrated'

export function ThemeControls() {
  const t = useTranslations('ThemeToggle')
  const locale = useLocale()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useHydrated()
  const [changingLocale, startLocaleTransition] = useTransition()
  const light = mounted && resolvedTheme === 'light'

  const changeLocale = (nextLocale: string | number) => {
    startLocaleTransition(async () => {
      await apiFetch('/api/preferences/locale', {
        method: 'POST',
        body: JSON.stringify({ locale: String(nextLocale) }),
      })
      router.refresh()
    })
  }

  const content = (
    <div className="theme-panel">
      <Typography.Text type="secondary">{t('section.mode')}</Typography.Text>
      <Segmented
        block
        value={light ? 'light' : 'dark'}
        onChange={(value) => setTheme(String(value))}
        options={[
          { label: t('mode.light'), value: 'light', icon: <Sun size={14} /> },
          { label: t('mode.dark'), value: 'dark', icon: <Moon size={14} /> },
        ]}
      />
      <Divider />
      <Typography.Text type="secondary">{t('section.language')}</Typography.Text>
      <Segmented
        block
        disabled={changingLocale}
        value={locale}
        onChange={changeLocale}
        options={[
          { label: t('language.en'), value: 'en' },
          { label: t('language.zh'), value: 'zh' },
        ]}
      />
    </div>
  )

  return (
    <Popover content={content} trigger="click" placement="bottomRight">
      <Button
        className="icon-action"
        aria-label={t('aria.openThemeSettings')}
        icon={light ? <Sun size={17} /> : <Moon size={17} />}
      />
    </Popover>
  )
}
