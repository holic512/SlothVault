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
import { Coins, Crown, FileSignature, KeyRound, LayoutDashboard, ShieldCheck, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'

import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

const AccountUserContext = createContext<SessionUser | null>(null)

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
  const t = useTranslations('Account.shell')
  const pathname = usePathname()
  const accountSections = [
    { href: '/account', label: t('overview'), icon: LayoutDashboard },
    { href: '/account/profile', label: t('profile'), icon: UserRound },
    { href: '/account/security', label: t('security'), icon: ShieldCheck },
    { href: '/account/contracts', label: t('contracts'), icon: FileSignature },
    { href: '/account/points', label: t('points'), icon: Coins },
    { href: '/account/membership', label: t('membership'), icon: Crown },
  ]
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
            <Typography.Text className="account-eyebrow">{t('kicker')}</Typography.Text>
            <Typography.Title level={1}>{user.displayName || user.username}</Typography.Title>
            <Typography.Text type="secondary">@{user.username} · {user.role === 'ADMIN' ? t('administrator') : t('user')}</Typography.Text>
          </div>
          <Space className="account-hero-actions" size={6}>
            {user.role === 'ADMIN' ? <Button type="primary" href="/admin/mm">{t('admin')}</Button> : null}
          </Space>
        </section>

        <div className="account-workspace">
          <aside className="account-section-rail" aria-label={t('navigationLabel')}>
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
              <span>{t('privacyNotice')}</span>
            </div>
          </aside>
          <section className="account-route-content">{children}</section>
        </div>
      </main>
    </AccountUserContext.Provider>
  )
}
