'use client'

/**
 * @file navigation-shell.tsx
 * @project SlothVault
 * @module Shared Navigation Shell
 * @description Gives public and project pages one fixed navigation geometry and appearance.
 * @logic Resolve the shared appearance preference once, wrap interchangeable navigation slots in the same surface, and keep responsive dimensions independent of page content.
 * @dependencies React, public-nav-style-context, liquid-glass-card, navigation-shell.module.css
 * @index_tags navigation,public,project,liquid-glass,responsive
 * @author holic512
 */
import type { ReactNode } from 'react'

import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import { LiquidGlassCard } from '@/components/ui/liquid-glass-card'
import styles from '@/styles/modules/navigation-shell.module.css'

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
    <header className={`${styles.wrap} ${kind}-nav-wrap`}>
      {liquid ? (
        <LiquidGlassCard
          className={`${styles.glass} ${kind}-nav-shell`}
          width="min(var(--sv-container-content), 100%)"
          margin="0 auto"
          padding={0}
          outerRadius="999px"
          blur={0.25}
          refraction={8}
          quality="high"
        >
          {navigation}
        </LiquidGlassCard>
      ) : navigation}
    </header>
  )
}
