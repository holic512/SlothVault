'use client'

import { App } from 'antd'
import { useTranslations } from 'next-intl'

import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import type { PublicNavStyle } from '@/theme/public-nav-style'

/** The same persisted choice controls navigation and account surfaces. */
export function SurfaceAppearanceControl({ compact = false }: { compact?: boolean }) {
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
    <div className={compact ? 'account-appearance-options' : 'theme-nav-style-options'} role="group" aria-label={t('section.navigation')}>
      {(['standard', 'liquid-glass'] as const).map((style) => (
        <button
          key={style}
          type="button"
          className={`${compact ? 'account-appearance-option' : 'theme-nav-style-card'}${publicNavStyle === style ? ' is-active' : ''}`}
          aria-pressed={publicNavStyle === style}
          disabled={changingPublicNavStyle}
          onClick={() => void select(style)}
        >
          {!compact && <span className={`theme-nav-style-preview theme-nav-style-preview--${style === 'standard' ? 'standard' : 'liquid'}`} aria-hidden="true"><i /><i /></span>}
          <strong>{t(style === 'standard' ? 'publicNav.standard' : 'publicNav.liquidGlass')}</strong>
          {!compact && <small>{t(style === 'standard' ? 'publicNav.standardDescription' : 'publicNav.liquidGlassDescription')}</small>}
        </button>
      ))}
    </div>
  )
}
