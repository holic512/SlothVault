import Link from 'next/link'

import { ThemeControls } from '@/components/theme/theme-controls'
import authStyles from '@/styles/modules/auth.module.css'

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${authStyles.root} auth-page`}>
      <header className="auth-topbar">
        <Link href="/" className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>Sloth<span className="brand-accent">Vault</span></span>
        </Link>
        <ThemeControls />
      </header>
      <main className="auth-main">{children}</main>
    </div>
  )
}
