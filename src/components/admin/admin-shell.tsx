'use client'

/**
 * @file admin-shell.tsx
 * @project SlothVault
 * @module Administrator Shell
 * @description Provides a responsive, grouped Ant Design navigation shell with an authenticated administrator header.
 * @logic Group site content, resources, user benefits, commissions, integrations, and maintenance alongside audience analytics and system observability without altering the standalone dashboard, share one breadcrumb model, and mount the signing-wallet tool only for evidence and contract workflows. Append authorized installed-plugin pages through the shared contribution registry.
 * @dependencies antd, next/dynamic, next/navigation, next-intl, brand-logo, theme-controls, wallet runtime, plugin UI registry
 * @index_tags admin,layout,navigation,sidebar,branding,menu-groups
 * @author holic512
 */
import { useMemo, useState, type ReactNode } from 'react'

import { Button, Drawer, Layout, Menu, Space, Tooltip, type MenuProps } from 'antd'
import {
  Activity,
  ChartNoAxesCombined,
  ArchiveRestore,
  Blocks,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Crown,
  FileStack,
  FileSignature,
  Home,
  House,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  Newspaper,
  PanelsTopLeft,
  Settings,
  TicketCheck,
  Trash2,
  Users,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { usePluginContributions, pluginPageHref } from '@/components/plugins/plugin-ui'
import { useLocale } from 'next-intl'
import { ThemeControls } from '@/components/theme/theme-controls'
import { BrandLogo } from '@/components/shell/brand-logo'
import { WalletRuntime } from '@/components/providers/wallet-runtime'
import { useQueryClient } from '@tanstack/react-query'
import { replaceClientSession } from '@/lib/session-client'
import { apiFetch } from '@/lib/api-client'
import adminStyles from '@/styles/modules/admin.module.css'
import type { SystemBranding } from '@/types/branding'

const { Header, Sider, Content } = Layout

function AdminWalletToolFallback() {
  const t = useTranslations('AdminMM.walletTool')

  return (
    <span className="admin-wallet-tool is-idle">
      <span className="wallet-adapter-dropdown">
        <button aria-expanded={false} className="wallet-adapter-button" disabled type="button">
          {t('actions.select')}
        </button>
      </span>
    </span>
  )
}

const AdminWalletTool = dynamic(
  () => import('@/components/admin/admin-wallet-tool').then(({ AdminWalletTool }) => AdminWalletTool),
  { loading: AdminWalletToolFallback, ssr: false },
)

type AdminMenuGroup = 'overview' | 'content' | 'resources' | 'users' | 'collaboration' | 'integrations' | 'system'
type AdminMenuRoute = {
  group: AdminMenuGroup
  key: string
  icon: ReactNode
  label: string
}

export function AdminShell({ children, branding }: { children: ReactNode; branding: SystemBranding }) {
  const t = useTranslations('AdminMM')
  const pathname = usePathname()
  const pluginContributions = usePluginContributions('admin')
  const pluginLocale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const menuRoutes = useMemo<AdminMenuRoute[]>(
    () => [
      { group: 'overview', key: '/admin/mm', icon: <PanelsTopLeft size={16} />, label: t('menu.dashboard') },
      { group: 'overview', key: '/admin/mm/analytics', icon: <ChartNoAxesCombined size={16} />, label: t('menu.analytics') },
      { group: 'content', key: '/admin/mm/homepage', icon: <House size={16} />, label: t('menu.homepage') },
      { group: 'content', key: '/admin/mm/articles', icon: <Newspaper size={16} />, label: t('menu.articles') },
      { group: 'content', key: '/admin/mm/projects', icon: <Blocks size={16} />, label: t('menu.projects') },
      { group: 'content', key: '/admin/mm/notes', icon: <BookOpenText size={16} />, label: t('menu.notes') },
      { group: 'resources', key: '/admin/mm/files', icon: <FileStack size={16} />, label: t('menu.files') },
      { group: 'resources', key: '/admin/mm/trash', icon: <Trash2 size={16} />, label: t('menu.trash') },
      { group: 'users', key: '/admin/mm/users', icon: <Users size={16} />, label: t('menu.users') },
      { group: 'users', key: '/admin/mm/membership-levels', icon: <Crown size={16} />, label: t('menu.membershipLevels') },
      ...(pluginContributions.data ?? []).filter(ui => ui.kind === 'page' && ui.menu).map(ui => ({ group: 'integrations' as const, key: pluginPageHref(ui), icon: <TicketCheck size={16} />, label: pluginLocale === 'zh' ? ui.titleZh ?? ui.title : ui.title })),
      { group: 'integrations', key: '/admin/mm/plugins', icon: <Blocks size={16} />, label: t('menu.plugins') },
      { group: 'collaboration', key: '/admin/mm/commissions', icon: <FileSignature size={16} />, label: t('menu.commissions') },
      { group: 'collaboration', key: '/admin/mm/contract-templates', icon: <FileSignature size={16} />, label: t('menu.contractTemplates') },
      { group: 'integrations', key: '/admin/mm/evidence', icon: <ArchiveRestore size={16} />, label: t('menu.solana') },
      { group: 'integrations', key: '/admin/mm/mcp', icon: <KeyRound size={16} />, label: t('menu.mcpKeys') },
      { group: 'system', key: '/admin/mm/observability', icon: <Activity size={16} />, label: t('menu.observability') },
      { group: 'system', key: '/admin/mm/backup', icon: <ArchiveRestore size={16} />, label: t('menu.backup') },
      { group: 'system', key: '/admin/mm/settings', icon: <Settings size={16} />, label: t('menu.settings') },
    ],
    [t, pluginContributions.data, pluginLocale],
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
      ...menuRoutes.filter((item) => item.group === 'overview').map((item) => ({ key: item.key, icon: item.icon, label: item.label })),
      group('content', t('menuGroups.content')),
      group('resources', t('menuGroups.resources')),
      group('users', t('menuGroups.users')),
      group('collaboration', t('menuGroups.collaboration')),
      group('integrations', t('menuGroups.integrations')),
      group('system', t('menuGroups.system')),
    ]
  }, [menuRoutes, t])

  const selectedKey =
    menuRoutes
      .map((item) => item.key)
      .filter((key) => pathname === key || (key !== '/admin/mm' && pathname.startsWith(`${key}/`)))
      .sort((a, b) => b.length - a.length)[0] || '/admin/mm'
  const currentLabel = menuRoutes.find((item) => item.key === selectedKey)?.label || t('title')
  const walletEnabled = pathname === '/admin/mm/evidence' || pathname.startsWith('/admin/mm/commissions')

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    await replaceClientSession(queryClient, null)
    router.replace('/login?next=/admin/mm')
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
        {walletEnabled ? (
          <WalletRuntime>
            <AdminWorkspace
              currentLabel={currentLabel}
              onOpenMobile={() => setMobileOpen(true)}
              onLogout={() => void logout()}
              walletEnabled
            >
              {children}
            </AdminWorkspace>
          </WalletRuntime>
        ) : (
          <AdminWorkspace
            currentLabel={currentLabel}
            onOpenMobile={() => setMobileOpen(true)}
            onLogout={() => void logout()}
            walletEnabled={false}
          >
            {children}
          </AdminWorkspace>
        )}
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

function AdminWorkspace({
  children,
  currentLabel,
  onOpenMobile,
  onLogout,
  walletEnabled,
}: {
  children: ReactNode
  currentLabel: string
  onOpenMobile: () => void
  onLogout: () => void
  walletEnabled: boolean
}) {
  const t = useTranslations('AdminMM')

  return <>
    <Header className="admin-header">
      <div className="admin-header-leading">
        <Button
          className="admin-mobile-trigger"
          aria-label={t('sidebar.openMobile')}
          icon={<MenuIcon size={17} />}
          onClick={onOpenMobile}
        />
        <nav className="admin-breadcrumb" aria-label={t('sidebar.breadcrumb')}>
          <Link href="/admin/mm">{t('title')}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{currentLabel}</span>
        </nav>
      </div>
      <Space size={6} className="admin-header-actions">
        {walletEnabled ? <AdminWalletTool /> : null}
        <Tooltip title={t('sidebar.home')}>
          <Button aria-label={t('sidebar.home')} icon={<Home size={16} />} href="/" />
        </Tooltip>
        <ThemeControls />
        <Tooltip title={t('sidebar.logout')}>
          <Button aria-label={t('sidebar.logout')} icon={<LogOut size={16} />} onClick={onLogout} />
        </Tooltip>
      </Space>
    </Header>
    <Content className="admin-content">{children}</Content>
  </>
}
