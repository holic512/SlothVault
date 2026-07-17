'use client'

import { useTransition } from 'react'

import { CheckOutlined } from '@ant-design/icons'
import { Button, Divider, Popover, Segmented, Space, Typography } from 'antd'
import { Moon, Palette as PaletteIcon, Sun } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'

import { apiFetch } from '@/lib/api-client'
import { useHydrated } from '@/hooks/use-hydrated'
import { palettes, usePreferencesStore, type Palette } from '@/stores/preferences'

export function ThemeControls() {
  const t = useTranslations('ThemeToggle')
  const locale = useLocale()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const palette = usePreferencesStore((state) => state.palette)
  const setPalette = usePreferencesStore((state) => state.setPalette)
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
      <Divider />
      <Typography.Text type="secondary">{t('section.color')}</Typography.Text>
      <Space wrap className="palette-options">
        {palettes.map((item) => (
          <Button
            key={item}
            className={`palette-option palette-option--${item}`}
            type={palette === item ? 'primary' : 'default'}
            icon={palette === item ? <CheckOutlined /> : undefined}
            onClick={() => setPalette(item as Palette)}
          >
            {t(`palette.${item}`)}
          </Button>
        ))}
      </Space>
    </div>
  )

  return (
    <Popover content={content} trigger="click" placement="bottomRight">
      <Button
        className="icon-action"
        aria-label={t('aria.openThemeSettings')}
        icon={light ? <Sun size={17} /> : <PaletteIcon size={17} />}
      />
    </Popover>
  )
}
