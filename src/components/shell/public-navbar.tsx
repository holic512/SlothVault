'use client'

/**
 * @file public-navbar.tsx
 * @project SlothVault
 * @module Public Navigation
 * @description Provides shared homepage, independent article, project, account, locale, and theme navigation for public pages.
 * @logic Highlight independent portal destinations precisely, render the server-resolved system brand, and switch only the top-nav shell between standard and liquid-glass appearances.
 * @dependencies next/link, next-intl, liquid-glass-card, public-nav-style-context, account-nav, brand-logo, theme-controls
 * @index_tags navbar,public,navigation,liquid-glass,branding,responsive
 * @author holic512
 */
import { useState } from 'react'

import { Button, Drawer } from 'antd'
import { FolderKanban, Menu, Newspaper } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LiquidGlassCard } from '@/components/ui/liquid-glass-card'
import { ThemeControls } from '@/components/theme/theme-controls'
import { AccountNav } from '@/components/auth/account-nav'
import { BrandLogo } from '@/components/shell/brand-logo'
import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import type { SystemBranding } from '@/types/branding'

export function PublicNavbar({ branding }: { branding: SystemBranding }) {
  const t = useTranslations('Nav')
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { publicNavStyle } = usePublicNavStyle()

  const navigation = (
    <nav
      className={`public-nav${publicNavStyle === 'liquid-glass' ? ' is-liquid-glass' : ''}`}
      aria-label="Primary navigation"
    >
      <Link href="/" className="brand-lockup" aria-label="SlothVault home">
        <BrandLogo branding={branding} />
        <span>Sloth<span className="brand-accent">Vault</span></span>
      </Link>

      <div className="public-nav-links">
        <Link className={pathname === '/' ? 'is-active' : ''} href="/">
          {t('home')}
        </Link>
        <Link
          className={pathname.startsWith('/articles') ? 'is-active' : ''}
          href="/articles"
        >
          <Newspaper size={15} />
          {t('articles')}
        </Link>
        <Link
          className={pathname.startsWith('/project') ? 'is-active' : ''}
          href="/project/projectList"
        >
          <FolderKanban size={15} />
          {t('projects')}
        </Link>
      </div>

      <div className="public-nav-actions">
        <AccountNav />
        <ThemeControls />
        <Button
          className="public-nav-menu"
          aria-label={t('openMenu')}
          icon={<Menu size={17} />}
          onClick={() => setMobileOpen(true)}
        />
      </div>
    </nav>
  )

  return (
    <header className="public-nav-wrap">
      {publicNavStyle === 'liquid-glass' ? (
        <LiquidGlassCard
          className="public-nav-shell"
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
      <Drawer
        className="mobile-nav-drawer"
        title="SlothVault"
        placement="right"
        size={320}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      >
        <nav className="mobile-nav-links" aria-label={t('mobileNavigation')}>
          <Link
            className={pathname === '/' ? 'is-active' : ''}
            href="/"
            onClick={() => setMobileOpen(false)}
          >
            {t('home')}
          </Link>
          <Link
            className={pathname.startsWith('/articles') ? 'is-active' : ''}
            href="/articles"
            onClick={() => setMobileOpen(false)}
          >
            <Newspaper size={17} />
            {t('articles')}
          </Link>
          <Link
            className={pathname.startsWith('/project') ? 'is-active' : ''}
            href="/project/projectList"
            onClick={() => setMobileOpen(false)}
          >
            <FolderKanban size={17} />
            {t('projects')}
          </Link>
        </nav>
      </Drawer>
    </header>
  )
}
