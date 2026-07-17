'use client'

/**
 * @file public-navbar.tsx
 * @project SlothVault
 * @module Public Navigation
 * @description Provides the shared brand, navigation, wallet, locale, and theme controls for public pages.
 * @logic Highlight the current route and keep all browser-only controls inside a responsive glass navigation shell.
 * @dependencies next/link, next-intl, antd, wallet-button, theme-controls
 * @index_tags navbar,public,navigation,responsive
 * @author holic512
 */
import { Button } from 'antd'
import { BookOpenText, LayoutDashboard } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { ThemeControls } from '@/components/theme/theme-controls'
import { WalletButton } from '@/components/wallet/wallet-button'

export function PublicNavbar() {
  const t = useTranslations('Nav')
  const pathname = usePathname()

  return (
    <header className="public-nav-wrap">
      <nav className="public-nav" aria-label="Primary navigation">
        <Link href="/" className="brand-lockup" aria-label="SlothVault home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="brand-logo" />
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
          <WalletButton />
          <Button className="console-link" icon={<LayoutDashboard size={16} />} href="/admin">
            Console
          </Button>
          <ThemeControls />
        </div>
      </nav>
    </header>
  )
}
