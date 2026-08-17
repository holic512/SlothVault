'use client'

/**
 * @file public-navbar.tsx
 * @project SlothVault
 * @module Public Navigation
 * @description Provides the shared brand, article navigation, conventional account, locale, and theme controls for public pages.
 * @logic Highlight the current route, render the server-resolved system brand, and keep the account/theme actions inside a restrained responsive navigation shell.
 * @dependencies next/link, next-intl, account-nav, brand-logo, theme-controls
 * @index_tags navbar,public,navigation,branding,responsive
 * @author holic512
 */
import { useState } from 'react'

import { Button, Drawer } from 'antd'
import { BookOpenText, Menu } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { ThemeControls } from '@/components/theme/theme-controls'
import { AccountNav } from '@/components/auth/account-nav'
import { BrandLogo } from '@/components/shell/brand-logo'
import type { SystemBranding } from '@/types/branding'

export function PublicNavbar({ branding }: { branding: SystemBranding }) {
  const t = useTranslations('Nav')
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="public-nav-wrap">
      <nav className="public-nav" aria-label="Primary navigation">
        <Link href="/" className="brand-lockup" aria-label="SlothVault home">
          <BrandLogo branding={branding} />
          <span>Sloth<span className="brand-accent">Vault</span></span>
        </Link>

        <div className="public-nav-links">
          <Link className={pathname === '/' ? 'is-active' : ''} href="/">
            {t('home')}
          </Link>
          <Link
            className={pathname.startsWith('/project') ? 'is-active' : ''}
            href="/project/projectList"
          >
            <BookOpenText size={15} />
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
            className={pathname.startsWith('/project') ? 'is-active' : ''}
            href="/project/projectList"
            onClick={() => setMobileOpen(false)}
          >
            <BookOpenText size={17} />
            {t('projects')}
          </Link>
        </nav>
      </Drawer>
    </header>
  )
}
