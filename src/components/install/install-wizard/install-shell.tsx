'use client'

/**
 * @file install-shell.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Renders the shared branded page shell around every installation state and workflow stage.
 * @logic Present the status header, theme controls, installation guarantees, stage workbench, and footer without owning workflow state.
 * @dependencies Ant Design, next-intl, theme-controls
 * @index_tags install,shell,layout,theme,status
 * @author holic512
 */
import { DatabaseOutlined, FileProtectOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Typography } from 'antd'
import { useTranslations } from 'next-intl'

import { ThemeControls } from '@/components/theme/theme-controls'

export function InstallShell({ children, statusLabel }: { children: React.ReactNode; statusLabel: string }) {
  const t = useTranslations('Install')

  return (
    <div className="install-page">
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
        <section className="install-manifesto">
          <div className="install-orbit" aria-hidden="true">
            <span className="install-orbit-core"><DatabaseOutlined /></span>
            <i className="install-orbit-node install-orbit-node--a" />
            <i className="install-orbit-node install-orbit-node--b" />
            <i className="install-orbit-node install-orbit-node--c" />
          </div>
          <Typography.Text className="install-kicker">{t('hero.badge')}</Typography.Text>
          <Typography.Title>{t('hero.title')}</Typography.Title>
          <Typography.Paragraph>{t('hero.desc')}</Typography.Paragraph>

          <div className="install-guarantees">
            <div><SafetyCertificateOutlined /><span><strong>{t('hero.secureTitle')}</strong>{t('hero.secureDesc')}</span></div>
            <div><FileProtectOutlined /><span><strong>{t('hero.portableTitle')}</strong>{t('hero.portableDesc')}</span></div>
            <div><DatabaseOutlined /><span><strong>{t('hero.emptyTitle')}</strong>{t('hero.emptyDesc')}</span></div>
          </div>
        </section>

        <section className="install-workbench">{children}</section>
      </main>
      <footer className="install-footer">{t('footer')}</footer>
    </div>
  )
}
