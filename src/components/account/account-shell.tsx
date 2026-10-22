'use client'

/**
 * @file account-shell.tsx
 * @project SlothVault
 * @module Personal Account Workspace
 * @description Provides a bounded identity rail, collapsible functional groups, and mobile account navigation.
 * @logic Share the verified session, merge authorized plugin routes, remember desktop preferences, reveal destination groups and keep mobile navigation in a drawer.
 * @dependencies React, React Query, Ant Design, Next navigation, account.module.css, navigation preferences, plugin contributions
 * @index_tags account,workspace,navigation,sidebar,responsive,plugins
 * @author holic512
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Avatar, Button, Drawer, Menu, Tooltip, Typography, type MenuProps } from 'antd'
import { Blocks, ChevronLeft, ChevronRight, Coins, Crown, FileSignature, LayoutDashboard, Menu as MenuIcon, ShieldCheck, UserRound } from 'lucide-react'
import Link from 'next/link'
import { pluginPageHref, usePluginContributions } from '@/components/plugins/plugin-ui'
import { PluginIcon } from '@/components/plugins/plugin-icon'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'

import { useNavigationPreferences } from '@/components/shell/use-navigation-preferences'
import { fetchSessionUser } from '@/lib/session-client'
import styles from '@/styles/modules/account.module.css'
import type { SessionUser } from '@/types/user'

const AccountUserContext = createContext<SessionUser | null>(null)

type AccountSection = { href: string; label: string; icon: ReactNode }
type AccountGroup = { id: string; label: string; icon: ReactNode; sections: AccountSection[] }

export function useAccountUser() {
  const user = useContext(AccountUserContext)
  if (!user) throw new Error('Account user context is unavailable')
  return user
}

export function AccountShell({ initialUser, children }: { initialUser: SessionUser; children: ReactNode }) {
  const t = useTranslations('Account.shell')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const plugins = usePluginContributions('account')
  const rail = useRef<HTMLDivElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const accountGroups: AccountGroup[] = [
    {
      id: 'account', label: t('groups.account'), icon: <UserRound size={18} />,
      sections: [
        { href: '/account', label: t('overview'), icon: <LayoutDashboard size={18} /> },
        { href: '/account/profile', label: t('profile'), icon: <UserRound size={18} /> },
        { href: '/account/security', label: t('security'), icon: <ShieldCheck size={18} /> },
      ],
    },
    {
      id: 'collaboration', label: t('groups.collaboration'), icon: <FileSignature size={18} />,
      sections: [{ href: '/account/commissions', label: t('commissions'), icon: <FileSignature size={18} /> }],
    },
    {
      id: 'benefits', label: t('groups.benefits'), icon: <Coins size={18} />,
      sections: [
        { href: '/account/points', label: t('points'), icon: <Coins size={18} /> },
        { href: '/account/membership', label: t('membership'), icon: <Crown size={18} /> },
      ],
    },
  ]
  const pluginSections = (plugins.data ?? []).filter(ui => ui.kind === 'page' && ui.menu).map(ui => ({
    href: pluginPageHref(ui), label: locale === 'zh' ? ui.titleZh ?? ui.title : ui.title,
    icon: <PluginIcon name={ui.icon} />,
  }))
  if (pluginSections.length) accountGroups.push({ id: 'plugins', label: t('groups.plugins'), icon: <Blocks size={18} />, sections: pluginSections })
  const active = accountGroups.flatMap(group => group.sections.map(section => ({ ...section, group: group.id })))
    .filter(section => pathname === section.href || (section.href !== '/account' && pathname.startsWith(`${section.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]
  const { collapsed, setCollapsed, openGroups, setOpenGroups } = useNavigationPreferences('account', active?.group, `${pathname}:${active?.group ?? ''}`)
  const openGroupKey = openGroups.join('|')
  useEffect(() => {
    const frame = requestAnimationFrame(() => rail.current?.querySelector('.ant-menu-item-selected')?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [pathname, collapsed, openGroupKey])
  const sessionQuery = useQuery({ queryKey: ['session-user'], queryFn: fetchSessionUser, initialData: initialUser })
  if (sessionQuery.data === null) return null
  const user = sessionQuery.data || initialUser
  const menuItems: MenuProps['items'] = accountGroups.map(group => ({
    key: group.id, label: group.label, icon: group.icon,
    children: group.sections.map(section => ({
      key: section.href, icon: section.icon,
      label: <Link href={section.href} aria-current={active?.href === section.href ? 'page' : undefined}>{section.label}</Link>,
    })),
  }))
  const identity = <div className="account-identity">
    <Avatar size={collapsed ? 36 : 44} src={user.avatar || undefined} icon={<UserRound size={21} />} aria-label={user.displayName || user.username} />
    <div className="account-identity-copy"><strong>{user.displayName || user.username}</strong><Typography.Text type="secondary">@{user.username}</Typography.Text></div>
  </div>
  const navigation = (mobile: boolean) => <Menu
    className={styles.navigation}
    aria-label={t('navigationLabel')}
    mode="inline"
    inlineIndent={16}
    inlineCollapsed={mobile ? false : collapsed}
    openKeys={mobile || !collapsed ? openGroups : undefined}
    onOpenChange={keys => { if (mobile || !collapsed) setOpenGroups(keys) }}
    selectedKeys={active ? [active.href] : []}
    items={menuItems}
    getPopupContainer={node => node.ownerDocument.body}
    onClick={({ key, domEvent }) => {
      // Consume Enter before the drawer restores focus to its trigger.
      if (domEvent.type === 'keydown') {
        domEvent.preventDefault()
        domEvent.stopPropagation()
        router.push(key)
      }
      setMobileOpen(false)
    }}
  />

  return <AccountUserContext.Provider value={user}>
    <main className={`${styles.root} account-main content-container${collapsed ? ` ${styles.collapsed}` : ''}`}>
      <div className={styles['mobile-bar']}>
        <Typography.Text strong>{active?.label ?? t('navigationLabel')}</Typography.Text>
        <Button aria-label={t('sidebar.openMobile')} aria-haspopup="dialog" aria-expanded={mobileOpen} icon={<MenuIcon size={18} />} onClick={() => setMobileOpen(true)} />
      </div>
      <div className="account-workspace">
        <aside className="account-section-rail" aria-label={t('navigationLabel')}>
          {identity}
          <div ref={rail} className={styles['menu-viewport']}>{navigation(false)}</div>
          <div className="account-rail-footer">
            {user.role === 'ADMIN' && <Tooltip title={collapsed ? t('admin') : undefined} placement="right">
              <Button block href="/admin/mm" aria-label={t('admin')} icon={collapsed ? <LayoutDashboard size={18} /> : undefined}>{collapsed ? null : t('admin')}</Button>
            </Tooltip>}
            <Button type="text" aria-expanded={!collapsed} aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')} icon={collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />} onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? null : t('sidebar.collapse')}
            </Button>
          </div>
        </aside>
        <section className="account-route-content">{children}</section>
      </div>
    </main>
    <Drawer className={styles['mobile-drawer']} title={t('navigationLabel')} placement="left" size={300} open={mobileOpen} onClose={() => setMobileOpen(false)}>
      <div className={styles['mobile-identity']}><Avatar size={36} src={user.avatar || undefined} icon={<UserRound size={18} />} /><span>{user.displayName || user.username}</span></div>
      {navigation(true)}
      {user.role === 'ADMIN' && <Button block href="/admin/mm">{t('admin')}</Button>}
    </Drawer>
  </AccountUserContext.Provider>
}
