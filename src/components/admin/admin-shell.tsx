'use client'

/**
 * @file admin-shell.tsx
 * @project SlothVault
 * @module Administrator Shell
 * @description Replaces the Nuxt admin layout with a responsive Ant Design navigation and authenticated header.
 * @logic Map routes to one menu/breadcrumb model, preserve collapse state locally, and expose home/theme/logout actions while keeping wallet use inside the optional copyright page.
 * @dependencies antd, next/navigation, next-intl, theme-controls
 * @index_tags admin,layout,navigation,sidebar
 * @author holic512
 */
import { useMemo, useState, type ReactNode } from 'react'

import { Button, Layout, Menu, Space, Tooltip, Typography } from 'antd'
import {
  ArchiveRestore,
  Blocks,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileStack,
  FolderTree,
  Home,
  House,
  LogOut,
  PanelsTopLeft,
  Settings,
  TicketCheck,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { ThemeControls } from '@/components/theme/theme-controls'
import { apiFetch } from '@/lib/api-client'

const { Header, Sider, Content } = Layout

export function AdminShell({
  children,
  username,
}: {
  children: ReactNode
  username: string
}) {
  const t = useTranslations('AdminMM')
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  const menuItems = useMemo(
    () => [
      { key: '/admin/mm', icon: <PanelsTopLeft size={17} />, label: t('menu.dashboard') },
      { key: '/admin/mm/homepage', icon: <House size={17} />, label: t('menu.homepage') },
      { key: '/admin/mm/projects', icon: <Blocks size={17} />, label: t('menu.projects') },
      { key: '/admin/mm/categories', icon: <FolderTree size={17} />, label: t('menu.categories') },
      { key: '/admin/mm/notes', icon: <BookOpenText size={17} />, label: t('menu.notes') },
      { key: '/admin/mm/files', icon: <FileStack size={17} />, label: t('menu.files') },
      { key: '/admin/mm/users', icon: <Users size={17} />, label: t('menu.users') },
      { key: '/admin/mm/gift-cards', icon: <TicketCheck size={17} />, label: t('menu.giftCards') },
      { key: '/admin/mm/solana', icon: <ArchiveRestore size={17} />, label: t('menu.solana') },
      { key: '/admin/mm/backup', icon: <ArchiveRestore size={17} />, label: t('menu.backup') },
      { key: '/admin/mm/settings', icon: <Settings size={17} />, label: t('menu.settings') },
    ],
    [t],
  )

  const selectedKey =
    menuItems
      .map((item) => item.key)
      .filter((key) => pathname === key || (key !== '/admin/mm' && pathname.startsWith(`${key}/`)))
      .sort((a, b) => b.length - a.length)[0] || '/admin/mm'
  const currentLabel = menuItems.find((item) => item.key === selectedKey)?.label || t('title')

  const logout = async () => {
    await apiFetch('/api/admin/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    router.replace('/admin/auth/login')
    router.refresh()
  }

  return (
    <Layout className="admin-layout">
      <Sider
        className="admin-sider"
        width={220}
        collapsedWidth={64}
        collapsible
        collapsed={collapsed}
        trigger={null}
      >
        <Link href="/admin/mm" className={`admin-brand ${collapsed ? 'is-collapsed' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" />
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
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          {!collapsed ? <span>{t('sidebar.collapse')}</span> : null}
        </button>
      </Sider>

      <Layout className="admin-main-layout">
        <Header className="admin-header">
          <div className="admin-header-copy">
            <Typography.Text type="secondary">{t('title')}</Typography.Text>
            <Typography.Title level={4}>{currentLabel}</Typography.Title>
          </div>
          <Space size={8} className="admin-header-actions">
            <Tooltip title="Home">
              <Button icon={<Home size={16} />} href="/" />
            </Tooltip>
            <ThemeControls />
            <Tooltip title={username}>
              <Button icon={<LogOut size={16} />} onClick={() => void logout()} />
            </Tooltip>
          </Space>
        </Header>
        <Content className="admin-content">{children}</Content>
      </Layout>
    </Layout>
  )
}
