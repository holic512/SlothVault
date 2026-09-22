'use client'

/**
 * @file account-nav.tsx
 * @project SlothVault
 * @module Public Account Navigation
 * @description Provides conventional login and an identity-aware dropdown for private account routes, administrator navigation, and logout.
 * @logic Resolve the shared session once, direct signed-in users to dedicated account sections, expose the console only to administrators, and revoke the session on logout.
 * @dependencies Ant Design, React Query, Next navigation, auth API
 * @index_tags navbar,account,dropdown,login,logout,admin
 * @author holic512
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Avatar, Button, Dropdown } from 'antd'
import { ChevronDown, CircleUserRound, Coins, Crown, FileSignature, LayoutDashboard, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { ApiClientError, apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

export function AccountNav({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('Account.nav')
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['session-user'],
    retry: false,
    queryFn: async () => {
      try {
        return await apiFetch<SessionUser | null>('/api/auth/session')
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) return null
        throw error
      }
    },
  })

  if (!query.data) {
    return (
      <Button icon={<LogIn size={16} />} href="/login">
        {compact ? null : t('login')}
      </Button>
    )
  }

  const user = query.data
  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    await queryClient.invalidateQueries({ queryKey: ['session-user'] })
    router.replace('/')
    router.refresh()
  }

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      arrow
      classNames={{ root: 'account-nav-dropdown' }}
      popupRender={(menu) => (
        <div className="account-nav-popup">
          <Link href="/account" className="account-nav-popup-header">
            <Avatar size={34} src={user.avatar || undefined} icon={<UserRound size={17} />} />
            <span>
              <strong>{user.displayName || user.username}</strong>
              <small>@{user.username}</small>
            </span>
            <ChevronDown size={15} aria-hidden />
          </Link>
          {menu}
        </div>
      )}
      menu={{
        items: [
          {
            key: 'overview',
            icon: <LayoutDashboard size={15} />,
            label: <Link href="/account">{t('overview')}</Link>,
          },
          {
            key: 'profile',
            icon: <UserRound size={15} />,
            label: <Link href="/account/profile">{t('profile')}</Link>,
          },
          {
            key: 'security',
            icon: <ShieldCheck size={15} />,
            label: <Link href="/account/security">{t('security')}</Link>,
          },
          {
            key: 'points',
            icon: <Coins size={15} />,
            label: <Link href="/account/points">{t('points')}</Link>,
          },
          {
            key: 'membership',
            icon: <Crown size={15} />,
            label: <Link href="/account/membership">{t('membership')}</Link>,
          },
          {
            key: 'contracts',
            icon: <FileSignature size={15} />,
            label: <Link href="/account/contracts">{t('contracts')}</Link>,
          },
          ...(user.role === 'ADMIN'
            ? [{
                key: 'admin',
                icon: <LayoutDashboard size={15} />,
                label: <Link href="/admin/mm">{t('admin')}</Link>,
              }]
            : []),
          { type: 'divider' as const },
          {
            key: 'logout',
            icon: <LogOut size={15} />,
            label: t('logout'),
            onClick: () => void logout(),
          },
        ],
      }}
    >
      <Button className={`account-nav-trigger${compact ? ' is-compact' : ''}`} type="text">
        <Avatar size={24} src={user.avatar || undefined} icon={<CircleUserRound size={15} />} />
        {compact ? null : <span className="account-nav-trigger-label">{user.displayName || user.username}</span>}
        <ChevronDown size={14} aria-hidden />
      </Button>
    </Dropdown>
  )
}
