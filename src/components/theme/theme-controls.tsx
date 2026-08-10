'use client'

/**
 * @file theme-controls.tsx
 * @project SlothVault
 * @module Theme and Locale Controls
 * @description Exposes visual style, light/dark mode, and language controls for every application surface.
 * @logic Persist visual style independently from color mode, update each preference optimistically, and restore the last style if persistence fails.
 * @dependencies antd, next-themes, next-intl, app-style-context, preferences API
 * @index_tags theme,style,locale,saas,accessibility
 * @author holic512
 */

import { useTransition } from 'react'

import { App, Button, Divider, Popover, Segmented, Typography } from 'antd'
import { Moon, PanelsTopLeft, Sun } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'

import { useResolvedAppTheme } from '@/components/providers/app-theme-context'
import { useAppStyle } from '@/components/providers/app-style-context'
import { apiFetch } from '@/lib/api-client'
import { isAppTheme } from '@/theme/app-theme'
import { isAppStyle } from '@/theme/app-style'

export function ThemeControls() {
  const t = useTranslations('ThemeToggle')
  const locale = useLocale()
  const router = useRouter()
  const { setTheme } = useTheme()
  const { message } = App.useApp()
  const resolvedTheme = useResolvedAppTheme()
  const { style, setStyle } = useAppStyle()
  const [changingLocale, startLocaleTransition] = useTransition()
  const [changingTheme, startThemeTransition] = useTransition()
  const [changingStyle, startStyleTransition] = useTransition()
  const light = resolvedTheme === 'light'

  const changeTheme = (nextTheme: string | number) => {
    const theme = String(nextTheme)
    if (!isAppTheme(theme)) return

    setTheme(theme)
    startThemeTransition(async () => {
      await apiFetch('/api/preferences/theme', {
        method: 'POST',
        body: JSON.stringify({ theme }),
      })
      router.refresh()
    })
  }

  const changeStyle = (nextStyle: string | number) => {
    const next = String(nextStyle)
    if (!isAppStyle(next) || next === style) return

    const previousStyle = style
    setStyle(next)
    startStyleTransition(async () => {
      try {
        await apiFetch('/api/preferences/style', {
          method: 'POST',
          body: JSON.stringify({ style: next }),
        })
        router.refresh()
      } catch (error) {
        setStyle(previousStyle)
        message.error(error instanceof Error ? error.message : t('messages.styleSaveFailed'))
      }
    })
  }

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
      <Typography.Text type="secondary">{t('section.style')}</Typography.Text>
      <Segmented
        block
        className="theme-style-segmented"
        disabled={changingStyle}
        value={style}
        onChange={changeStyle}
        options={[
          {
            label: <span className="theme-style-option">{t('style.mono')}</span>,
            value: 'mono',
            icon: <PanelsTopLeft size={14} />,
          },
          {
            label: <span className="theme-style-option">{t('style.saas')}</span>,
            value: 'saas',
            icon: <span className="theme-saas-dot" aria-hidden="true" />,
          },
        ]}
      />
      <Divider />
      <Typography.Text type="secondary">{t('section.mode')}</Typography.Text>
      <Segmented
        block
        disabled={changingTheme}
        value={light ? 'light' : 'dark'}
        onChange={changeTheme}
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
