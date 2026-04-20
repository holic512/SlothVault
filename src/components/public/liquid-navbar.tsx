'use client'

import Link from 'next/link'
import { ThemeToggle } from '@/components/theme/theme-toggle'

export function LiquidNavbar() {
  return (
    <nav className="liquid-navbar">
      <div className="navbar-inner">
        <Link href="/" className="brand">
          <img src="/logo.png" className="brand-icon" alt="Logo" />
          <span className="brand-text">SlothVault</span>
        </Link>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link href="/project/projectList">Projects</Link>
          <Link href="/admin/auth/login">Console</Link>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}
