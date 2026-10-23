'use client'

/**
 * @file admin-shell.tsx
 * @project SlothVault
 * @module Administrator Shell
 * @description Provides a responsive, grouped Ant Design navigation shell with an authenticated administrator header.
 * @logic Keep overview entries visible, fold functional groups with local preferences, reveal the active route, and contain scrolling between fixed brand and collapse controls. Use body-mounted icon-mode submenus and a mobile drawer; isolate installed-plugin routes in their own group.
 * @dependencies antd, next/dynamic, next/navigation, next-intl, brand-logo, theme-controls, wallet runtime, plugin UI registry
 * @index_tags admin,layout,navigation,sidebar,branding,menu-groups
 * @author holic512
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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
  Home,
  House,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  Newspaper,
  PanelsTopLeft,
  Settings,
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
import navigationStyles from '@/styles/modules/admin-navigation.module.css'
import { useNavigationPreferences } from '@/components/shell/use-navigation-preferences'
import { PluginIcon } from '@/components/plugins/plugin-icon'
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

type AdminMenuGroup = 'overview' | 'content' | 'resources' | 'users' | 'integrations' | 'plugins' | 'system'
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
  const rail = useRef<HTMLDivElement>(null)
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
      ...(pluginContributions.data ?? []).filter(ui => ui.kind === 'page' && ui.menu).map(ui => ({ group: 'plugins' as const, key: pluginPageHref(ui), icon: <PluginIcon name={ui.icon} />, label: pluginLocale === 'zh' ? ui.titleZh ?? ui.title : ui.title })),
      { group: 'plugins', key: '/admin/mm/plugins', icon: <Blocks size={16} />, label: t('menu.plugins') },
      { group: 'integrations', key: '/admin/mm/evidence', icon: <ArchiveRestore size={16} />, label: t('menu.solana') },
      { group: 'integrations', key: '/admin/mm/mcp', icon: <KeyRound size={16} />, label: t('menu.mcpKeys') },
      { group: 'system', key: '/admin/mm/observability', icon: <Activity size={16} />, label: t('menu.observability') },
      { group: 'system', key: '/admin/mm/backup', icon: <ArchiveRestore size={16} />, label: t('menu.backup') },
      { group: 'system', key: '/admin/mm/settings', icon: <Settings size={16} />, label: t('menu.settings') },
    ],
    [t, pluginContributions.data, pluginLocale],
  )

  const selectedKey =
    menuRoutes
      .map((item) => item.key)
      .filter((key) => pathname === key || (key !== '/admin/mm' && pathname.startsWith(`${key}/`)))
      .sort((a, b) => b.length - a.length)[0] || '/admin/mm'

  const menuItems = useMemo<MenuProps['items']>(() => {
    const routeItem = (item: AdminMenuRoute) => ({
      key: item.key,
      icon: item.icon,
      label: <Link href={item.key} aria-current={item.key === selectedKey ? 'page' : undefined}>{item.label}</Link>,
    })
    const group = (key: AdminMenuGroup, label: string, icon: ReactNode) => ({
      icon,
      key,
      label,
      children: menuRoutes
        .filter((item) => item.group === key)
        .map(routeItem),
    })
    return [
      ...menuRoutes.filter((item) => item.group === 'overview').map(routeItem),
      group('content', t('menuGroups.content'), <BookOpenText size={16} />),
      group('resources', t('menuGroups.resources'), <FileStack size={16} />),
      group('users', t('menuGroups.users'), <Users size={16} />),
      group('integrations', t('menuGroups.integrations'), <KeyRound size={16} />),
      group('plugins', t('menuGroups.plugins'), <Blocks size={16} />),
      group('system', t('menuGroups.system'), <Settings size={16} />),
    ]
  }, [menuRoutes, selectedKey, t])

  const currentLabel = menuRoutes.find((item) => item.key === selectedKey)?.label || t('title')
  const activeGroup = menuRoutes.find(item => item.key === selectedKey)?.group
  const { collapsed, setCollapsed, openGroups, setOpenGroups } = useNavigationPreferences('admin', activeGroup === 'overview' ? undefined : activeGroup, `${pathname}:${activeGroup ?? ''}`)
  const openGroupKey = openGroups.join('|')
  useEffect(() => {
    const frame = requestAnimationFrame(() => rail.current?.querySelector('.ant-menu-item-selected')?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [selectedKey, collapsed, openGroupKey])
  const walletEnabled = pathname === '/admin/mm/evidence'

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    await replaceClientSession(queryClient, null)
    router.replace('/login?next=/admin/mm')
    router.refresh()
  }

  return (
    <Layout className={`${adminStyles.root} ${navigationStyles.root} admin-layout`}>
      <Sider
        className="admin-sider"
        width={216}
        collapsedWidth={56}
        collapsible
        collapsed={collapsed}
        trigger={null}
      >
        <Link href="/admin/mm" className={`admin-brand ${collapsed ? 'is-collapsed' : ''}`}>
          <BrandLogo branding={branding} />
          {!collapsed ? <span>{t('title')}</span> : null}
        </Link>
        <div ref={rail} className={navigationStyles['menu-viewport']}>
          <Menu
            className="admin-menu"
            aria-label={t('title')}
            openKeys={collapsed ? undefined : openGroups}
            onOpenChange={keys => { if (!collapsed) setOpenGroups(keys) }}
            getPopupContainer={node => node.ownerDocument.body}
            inlineIndent={16}
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key, domEvent }) => {
              if (domEvent.type === 'keydown') {
                domEvent.preventDefault()
                domEvent.stopPropagation()
                router.push(key)
              }
            }}
        />
        </div>
        <button
          className="admin-collapse"
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-expanded={!collapsed}
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
              mobileOpen={mobileOpen}
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
            mobileOpen={mobileOpen}
            onOpenMobile={() => setMobileOpen(true)}
            onLogout={() => void logout()}
            walletEnabled={false}
          >
            {children}
          </AdminWorkspace>
        )}
      </Layout>
      <Drawer
        className={`admin-mobile-drawer ${navigationStyles.mobile}`}
        title={t('title')}
        placement="left"
        size={288}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      >
        <Menu
          className="admin-mobile-menu"
          aria-label={t('title')}
          openKeys={openGroups}
          onOpenChange={setOpenGroups}
          inlineIndent={16}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
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
      </Drawer>
    </Layout>
  )
}

function AdminWorkspace({
  children,
  currentLabel,
  mobileOpen,
  onOpenMobile,
  onLogout,
  walletEnabled,
}: {
  children: ReactNode
  currentLabel: string
  mobileOpen: boolean
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
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
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
