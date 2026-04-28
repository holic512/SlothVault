'use client'

import {
  AppstoreOutlined,
  BookOutlined,
  FileOutlined,
  HomeOutlined,
  SettingOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  ApiOutlined
} from '@ant-design/icons'
import { Breadcrumb, Button, Flex, Layout, Menu } from 'antd'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { PropsWithChildren, useMemo } from 'react'

import { ThemeToggle } from '@/components/theme/theme-toggle'
import { WalletConnector } from '@/components/public/wallet-connector'

const items = [
  { key: '/admin/mm', icon: <HomeOutlined />, label: <Link href="/admin/mm">Dashboard</Link> },
  { key: '/admin/mm/homepage', icon: <BookOutlined />, label: <Link href="/admin/mm/homepage">Homepage</Link> },
  { key: '/admin/mm/projects', icon: <AppstoreOutlined />, label: <Link href="/admin/mm/projects">Projects</Link> },
  { key: '/admin/mm/categories', icon: <FolderOpenOutlined />, label: <Link href="/admin/mm/categories">Categories</Link> },
  { key: '/admin/mm/notes', icon: <BookOutlined />, label: <Link href="/admin/mm/notes">Notes</Link> },
  { key: '/admin/mm/files', icon: <FileOutlined />, label: <Link href="/admin/mm/files">Files</Link> },
  { key: '/admin/mm/solana', icon: <ApiOutlined />, label: <Link href="/admin/mm/solana">Solana</Link> },
  { key: '/admin/mm/backup', icon: <DatabaseOutlined />, label: <Link href="/admin/mm/backup">Backup</Link> },
  { key: '/admin/mm/settings', icon: <SettingOutlined />, label: <Link href="/admin/mm/settings">Settings</Link> }
]

export function AdminShell({ children }: PropsWithChildren) {
  const pathname = usePathname()
  const router = useRouter()
  const selectedKey = useMemo(() => {
    return items.find((item) => pathname.startsWith(item.key))?.key || '/admin/mm'
  }, [pathname])

  const crumbs = pathname
    .split('/')
    .filter(Boolean)
    .map((segment, index, segments) => ({
      title: segment,
      href: `/${segments.slice(0, index + 1).join('/')}`
    }))

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={220}>
        <div style={{ color: '#fff', fontWeight: 700, padding: 20 }}>SlothVault MM</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={items} />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', paddingInline: 24 }}>
          <Flex align="center" justify="space-between">
            <Breadcrumb items={crumbs} />
            <Flex gap={12}>
              <WalletConnector />
              <Button onClick={() => router.push('/')}>Home</Button>
              <ThemeToggle />
            </Flex>
          </Flex>
        </Layout.Header>
        <Layout.Content style={{ margin: 24 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  )
}
