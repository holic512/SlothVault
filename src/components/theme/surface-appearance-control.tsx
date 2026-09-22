'use client'

import { App } from 'antd'
import { Droplets, Square } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import type { PublicNavStyle } from '@/theme/public-nav-style'

/** The same persisted choice controls navigation and account surfaces. */
export function SurfaceAppearanceControl() {
  const t = useTranslations('ThemeToggle')
  const { message } = App.useApp()
  const { publicNavStyle, changingPublicNavStyle, changePublicNavStyle } = usePublicNavStyle()
  const select = async (style: PublicNavStyle) => {
    try {
      await changePublicNavStyle(style)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('messages.publicNavStyleSaveFailed'))
    }
  }

  return (
    <div className="surface-style-options" role="group" aria-label={t('section.cardStyle')}>
      {(['standard', 'liquid-glass'] as const).map((style) => (
        <button
          key={style}
          type="button"
          className={`surface-style-option${publicNavStyle === style ? ' is-active' : ''}`}
          aria-pressed={publicNavStyle === style}
          disabled={changingPublicNavStyle}
          onClick={() => void select(style)}
        >
          {style === 'standard' ? <Square size={14} aria-hidden /> : <Droplets size={14} aria-hidden />}
          <span>{t(style === 'standard' ? 'publicNav.standard' : 'publicNav.liquidGlass')}</span>
        </button>
      ))}
    </div>
  )
}
