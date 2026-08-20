'use client'

/**
 * @file account-shell.tsx
 * @project SlothVault
 * @module Personal Account Workspace
 * @description Provides the authenticated account header, section navigation, and shared session state for split account routes.
 * @logic Use the server-verified account as initial state, keep the client session query synchronized after profile mutations, and route each account concern to its own workspace view.
 * @dependencies React, React Query, Ant Design, Next navigation, auth session API
 * @index_tags account,workspace,navigation,profile,security,points
 * @author holic512
 */
import { createContext, useContext, type ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Avatar, Button, Space, Typography } from 'antd'
import { Coins, FileSignature, KeyRound, LayoutDashboard, ShieldCheck, UserRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

const AccountUserContext = createContext<SessionUser | null>(null)

const accountSections = [
  { href: '/account', label: '账户概览', icon: LayoutDashboard },
  { href: '/account/profile', label: '个人资料', icon: UserRound },
  { href: '/account/security', label: '安全与登录', icon: ShieldCheck },
  { href: '/account/contracts', label: '我的合同', icon: FileSignature },
  { href: '/account/points', label: '积分中心', icon: Coins },
]

export function useAccountUser() {
  const user = useContext(AccountUserContext)
  if (!user) throw new Error('Account user context is unavailable')
  return user
}

export function AccountShell({
  initialUser,
  children,
}: {
  initialUser: SessionUser
  children: ReactNode
}) {
  const pathname = usePathname()
  const sessionQuery = useQuery({
    queryKey: ['session-user'],
    queryFn: () => apiFetch<SessionUser | null>('/api/auth/session'),
    initialData: initialUser,
  })
  const user = sessionQuery.data || initialUser

  return (
    <AccountUserContext.Provider value={user}>
      <main className="account-main content-container">
        <section className="account-hero account-hero--workspace">
          <Avatar size={54} src={user.avatar || undefined} icon={<UserRound />} />
          <div>
            <Typography.Text className="account-eyebrow">Account workspace</Typography.Text>
            <Typography.Title level={1}>{user.displayName || user.username}</Typography.Title>
            <Typography.Text type="secondary">@{user.username} · {user.role === 'ADMIN' ? '管理员' : '个人用户'}</Typography.Text>
          </div>
          <Space className="account-hero-actions" size={6}>
            {user.role === 'ADMIN' ? <Button type="primary" href="/admin/mm">管理后台</Button> : null}
          </Space>
        </section>

        <div className="account-workspace">
          <aside className="account-section-rail" aria-label="账户功能导航">
            <nav className="account-section-nav">
              {accountSections.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={pathname === href ? 'is-active' : ''}>
                  <Icon size={16} />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
            <div className="account-section-rail-note">
              <KeyRound size={14} />
              <span>账户数据与登录凭据仅对本人可见。</span>
            </div>
          </aside>
          <section className="account-route-content">{children}</section>
        </div>
      </main>
    </AccountUserContext.Provider>
  )
}
