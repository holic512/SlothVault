/**
 * @file auth-frame.tsx
 * @project SlothVault
 * @module Authentication Page Shell
 * @description Renders the shared authentication chrome with the current installed-system brand and theme controls.
 * @logic Resolve non-blocking branding on the server before rendering the client-side Logo fallback and the supplied authentication content.
 * @dependencies next/link, brand-logo, theme-controls, system-branding
 * @index_tags auth,layout,branding,logo,theme
 * @author holic512
 */
import Link from 'next/link'

import { BrandLogo } from '@/components/shell/brand-logo'
import { ThemeControls } from '@/components/theme/theme-controls'
import { getSystemBranding } from '@/server/services/system-branding'
import authStyles from '@/styles/modules/auth.module.css'

export async function AuthFrame({ children }: { children: React.ReactNode }) {
  const branding = await getSystemBranding()

  return (
    <div className={`${authStyles.root} auth-page`}>
      <header className="auth-topbar">
        <Link href="/" className="brand-lockup">
          <BrandLogo branding={branding} />
          <span>Sloth<span className="brand-accent">Vault</span></span>
        </Link>
        <ThemeControls />
      </header>
      <main className="auth-main">{children}</main>
    </div>
  )
}
