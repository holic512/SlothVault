'use client'

/**
 * @file install-shell.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Renders the focused branded page shell around every installation state and workflow stage.
 * @logic Present the compact status header, centered installation workbench, and theme controls without owning workflow state.
 * @dependencies Ant Design, next-intl, theme-controls
 * @index_tags install,shell,layout,theme,status
 * @author holic512
 */
import { ThemeControls } from '@/components/theme/theme-controls'
import installStyles from '@/styles/modules/install.module.css'

export function InstallShell({ children, statusLabel }: { children: React.ReactNode; statusLabel: string }) {
  return (
    <div className={`${installStyles.root} install-page`}>
      <div className="install-ambient install-ambient--one" />
      <div className="install-ambient install-ambient--two" />
      <header className="install-topbar">
        <div className="brand-lockup" aria-label="SlothVault">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>Sloth<span className="brand-accent">Vault</span></span>
        </div>
        <div className="install-topbar-actions">
          <span className="install-status-pill"><i />{statusLabel}</span>
          <ThemeControls />
        </div>
      </header>

      <main className="install-main">
        <section className="install-workbench">{children}</section>
      </main>
    </div>
  )
}
