'use client'

/**
 * @file theme-controls.tsx
 * @project SlothVault
 * @module Theme and Locale Controls
 * @description Exposes visual style, public-navigation appearance, light/dark mode, and language controls for every application surface.
 * @logic Persist appearance preferences independently, update each preference optimistically, and restore the last selection if persistence fails.
 * @dependencies antd, next-intl, app-theme-context, app-style-context, public-nav-style-context, preferences API
 * @index_tags theme,style,public-nav,liquid-glass,locale,saas,accessibility
 * @author holic512
 */

import { useTransition } from 'react'

import { App, Button, Divider, Popover, Segmented, Typography } from 'antd'
import { Moon, PanelsTopLeft, Sun } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { useAppTheme, useResolvedAppTheme } from '@/components/providers/app-theme-context'
import { useAppStyle } from '@/components/providers/app-style-context'
import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import { apiFetch } from '@/lib/api-client'
import { isAppTheme } from '@/theme/app-theme'
import { isAppStyle } from '@/theme/app-style'
import { isPublicNavStyle } from '@/theme/public-nav-style'

export function ThemeControls() {
  const t = useTranslations('ThemeToggle')
  const locale = useLocale()
  const router = useRouter()
  const { setTheme } = useAppTheme()
  const { message } = App.useApp()
  const resolvedTheme = useResolvedAppTheme()
  const { style, setStyle } = useAppStyle()
  const { publicNavStyle, setPublicNavStyle } = usePublicNavStyle()
  const [changingLocale, startLocaleTransition] = useTransition()
  const [changingTheme, startThemeTransition] = useTransition()
  const [changingStyle, startStyleTransition] = useTransition()
  const [changingPublicNavStyle, startPublicNavStyleTransition] = useTransition()
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

  const changePublicNavStyle = (nextStyle: string) => {
    if (!isPublicNavStyle(nextStyle) || nextStyle === publicNavStyle) return

    const previousStyle = publicNavStyle
    setPublicNavStyle(nextStyle)
    startPublicNavStyleTransition(async () => {
      try {
        await apiFetch('/api/preferences/public-nav-style', {
          method: 'POST',
          body: JSON.stringify({ publicNavStyle: nextStyle }),
        })
        router.refresh()
      } catch (error) {
        setPublicNavStyle(previousStyle)
        message.error(error instanceof Error ? error.message : t('messages.publicNavStyleSaveFailed'))
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
      <Typography.Text type="secondary">{t('section.navigation')}</Typography.Text>
      <div className="theme-nav-style-options" role="radiogroup" aria-label={t('section.navigation')}>
        <button
          type="button"
          className={`theme-nav-style-card${publicNavStyle === 'standard' ? ' is-active' : ''}`}
          role="radio"
          aria-checked={publicNavStyle === 'standard'}
          disabled={changingPublicNavStyle}
          onClick={() => changePublicNavStyle('standard')}
        >
          <span className="theme-nav-style-preview theme-nav-style-preview--standard" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>{t('publicNav.standard')}</strong>
          <small>{t('publicNav.standardDescription')}</small>
        </button>
        <button
          type="button"
          className={`theme-nav-style-card${publicNavStyle === 'liquid-glass' ? ' is-active' : ''}`}
          role="radio"
          aria-checked={publicNavStyle === 'liquid-glass'}
          disabled={changingPublicNavStyle}
          onClick={() => changePublicNavStyle('liquid-glass')}
        >
          <span className="theme-nav-style-preview theme-nav-style-preview--liquid" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>{t('publicNav.liquidGlass')}</strong>
          <small>{t('publicNav.liquidGlassDescription')}</small>
        </button>
      </div>
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
