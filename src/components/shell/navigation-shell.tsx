'use client'

/**
 * @file navigation-shell.tsx
 * @project SlothVault
 * @module Shared Navigation Shell
 * @description Gives public and project pages one fixed navigation geometry and appearance.
 * @logic Resolve shared appearance, keep navigation geometry stable, and mount navigation popups in an unfiltered fixed host so document scrolling does not move them.
 * @dependencies React, Ant Design ConfigProvider, public-nav-style-context, liquid-glass-card, navigation-shell.module.css
 * @index_tags navigation,public,project,liquid-glass,responsive
 * @author holic512
 */
import type { ReactNode } from 'react'
import { ConfigProvider } from 'antd'

import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import { LiquidGlassCard } from '@/components/ui/liquid-glass-card'
import styles from '@/styles/modules/navigation-shell.module.css'

export function getNavigationPopupContainer(triggerNode?: HTMLElement): HTMLElement {
  return triggerNode?.closest('[data-navigation-shell]')
    ?.querySelector<HTMLElement>('[data-navigation-popup-host]')
    ?? triggerNode?.ownerDocument.body
    ?? document.body
}

export function NavigationShell({
  kind,
  brand,
  links,
  actions,
}: {
  kind: 'public' | 'project'
  brand: ReactNode
  links: ReactNode
  actions: ReactNode
}) {
  const { publicNavStyle } = usePublicNavStyle()
  const liquid = publicNavStyle === 'liquid-glass'
  const navigation = (
    <nav
      className={`${styles.navigation} ${kind}-nav${liquid ? ` ${styles.liquid} is-liquid-glass` : ''}`}
      aria-label="Primary navigation"
    >
      <div className={styles.brand}>{brand}</div>
      <div className={`${styles.links} ${kind === 'public' ? 'public-nav-links' : 'project-nav-center'}`}>
        {links}
      </div>
      <div className={`${styles.actions} ${kind}-nav-actions`}>{actions}</div>
    </nav>
  )

  return (
    <header className={`${styles.wrap} ${kind}-nav-wrap`} data-navigation-shell={kind}>
      <ConfigProvider getPopupContainer={getNavigationPopupContainer}>
        <LiquidGlassCard
          enabled={liquid}
          className={`${styles.glass} ${kind}-nav-shell`}
          width="min(var(--sv-container-content), 100%)"
          margin="0 auto"
          padding={0}
          outerRadius={liquid ? '999px' : '20px'}
          blur={0.25}
          refraction={8}
          quality="high"
        >
          {navigation}
        </LiquidGlassCard>
      </ConfigProvider>
      <div className={styles['popup-host']} data-navigation-popup-host />
    </header>
  )
}
