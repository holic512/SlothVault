'use client'

/**
 * @file admin-shell.tsx
 * @project SlothVault
 * @module Administrator Shell
 * @description Provides a responsive, grouped Ant Design navigation shell with an authenticated administrator header.
 * @logic Map routes into compact labeled sidebar groups and one breadcrumb model, render the server-resolved system brand, preserve collapse state locally, and expose home/theme/logout actions while keeping wallet use inside the transaction-evidence center.
 * @dependencies antd, next/navigation, next-intl, brand-logo, theme-controls
 * @index_tags admin,layout,navigation,sidebar,branding,menu-groups
 * @author holic512
 */
import { useMemo, useState, type ReactNode } from 'react'

import { Button, Drawer, Layout, Menu, Space, Tooltip, type MenuProps } from 'antd'
import {
  ArchiveRestore,
  Blocks,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileStack,
  FileSignature,
  Home,
  House,
  LogOut,
  Menu as MenuIcon,
  Newspaper,
  PanelsTopLeft,
  Settings,
  TicketCheck,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { ThemeControls } from '@/components/theme/theme-controls'
import { BrandLogo } from '@/components/shell/brand-logo'
import { apiFetch } from '@/lib/api-client'
import adminStyles from '@/styles/modules/admin.module.css'
import type { SystemBranding } from '@/types/branding'

const { Header, Sider, Content } = Layout

type AdminMenuGroup = 'overview' | 'content' | 'users' | 'system'
type AdminMenuRoute = {
  group: AdminMenuGroup
  key: string
  icon: ReactNode
  label: string
}

export function AdminShell({ children, branding }: { children: ReactNode; branding: SystemBranding }) {
  const t = useTranslations('AdminMM')
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const menuRoutes = useMemo<AdminMenuRoute[]>(
    () => [
      { group: 'overview', key: '/admin/mm', icon: <PanelsTopLeft size={16} />, label: t('menu.dashboard') },
      { group: 'content', key: '/admin/mm/homepage', icon: <House size={16} />, label: t('menu.homepage') },
      { group: 'content', key: '/admin/mm/articles', icon: <Newspaper size={16} />, label: t('menu.articles') },
      { group: 'content', key: '/admin/mm/projects', icon: <Blocks size={16} />, label: t('menu.projects') },
      { group: 'content', key: '/admin/mm/notes', icon: <BookOpenText size={16} />, label: t('menu.notes') },
      { group: 'content', key: '/admin/mm/files', icon: <FileStack size={16} />, label: t('menu.files') },
      { group: 'users', key: '/admin/mm/users', icon: <Users size={16} />, label: t('menu.users') },
      { group: 'users', key: '/admin/mm/contracts', icon: <FileSignature size={16} />, label: t('menu.contracts') },
      { group: 'users', key: '/admin/mm/gift-cards', icon: <TicketCheck size={16} />, label: t('menu.giftCards') },
      { group: 'system', key: '/admin/mm/evidence', icon: <ArchiveRestore size={16} />, label: t('menu.solana') },
      { group: 'system', key: '/admin/mm/backup', icon: <ArchiveRestore size={16} />, label: t('menu.backup') },
      { group: 'system', key: '/admin/mm/settings', icon: <Settings size={16} />, label: t('menu.settings') },
    ],
    [t],
  )

  const menuItems = useMemo<MenuProps['items']>(() => {
    const group = (key: AdminMenuGroup, label: string) => ({
      type: 'group' as const,
      key,
      label,
      children: menuRoutes
        .filter((item) => item.group === key)
        .map((item) => ({ key: item.key, icon: item.icon, label: item.label })),
    })
    return [
      group('overview', t('menuGroups.overview')),
      group('content', t('menuGroups.content')),
      group('users', t('menuGroups.users')),
      group('system', t('menuGroups.system')),
    ]
  }, [menuRoutes, t])

  const selectedKey =
    menuRoutes
      .map((item) => item.key)
      .filter((key) => pathname === key || (key !== '/admin/mm' && pathname.startsWith(`${key}/`)))
      .sort((a, b) => b.length - a.length)[0] || '/admin/mm'
  const currentLabel = menuRoutes.find((item) => item.key === selectedKey)?.label || t('title')

  const logout = async () => {
    await apiFetch('/api/admin/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    router.replace('/admin/auth/login')
    router.refresh()
  }

  return (
    <Layout className={`${adminStyles.root} admin-layout`}>
      <Sider
        className="admin-sider"
        width={184}
        collapsedWidth={48}
        collapsible
        collapsed={collapsed}
        trigger={null}
      >
        <Link href="/admin/mm" className={`admin-brand ${collapsed ? 'is-collapsed' : ''}`}>
          <BrandLogo branding={branding} />
          {!collapsed ? <span>{t('title')}</span> : null}
        </Link>
        <Menu
          className="admin-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
        <button
          className="admin-collapse"
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed ? <span>{t('sidebar.collapse')}</span> : null}
        </button>
      </Sider>

      <Layout className="admin-main-layout">
        <Header className="admin-header">
          <div className="admin-header-leading">
            <Button
              className="admin-mobile-trigger"
              aria-label={t('sidebar.openMobile')}
              icon={<MenuIcon size={17} />}
              onClick={() => setMobileOpen(true)}
            />
            <nav className="admin-breadcrumb" aria-label="Breadcrumb">
              <Link href="/admin/mm">{t('title')}</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{currentLabel}</span>
            </nav>
          </div>
          <Space size={6} className="admin-header-actions">
            <Tooltip title={t('sidebar.home')}>
              <Button aria-label={t('sidebar.home')} icon={<Home size={16} />} href="/" />
            </Tooltip>
            <ThemeControls />
            <Tooltip title={t('sidebar.logout')}>
              <Button aria-label={t('sidebar.logout')} icon={<LogOut size={16} />} onClick={() => void logout()} />
            </Tooltip>
          </Space>
        </Header>
        <Content className="admin-content">{children}</Content>
      </Layout>
      <Drawer
        className="admin-mobile-drawer"
        title={t('title')}
        placement="left"
        size={228}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      >
        <Menu
          className="admin-mobile-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => {
            setMobileOpen(false)
            router.push(key)
          }}
        />
      </Drawer>
    </Layout>
  )
}
