'use client'

/**
 * @file account-nav.tsx
 * @project SlothVault
 * @module Public Account Navigation
 * @description Replaces the former global wallet control with conventional login, account, profile, and administrator navigation.
 * @logic Resolve the shared session once, show a quiet account menu for signed-in users, expose the console only to administrators, and revoke the session on logout.
 * @dependencies Ant Design, React Query, Next navigation, auth API
 * @index_tags navbar,account,login,logout,admin
 * @author holic512
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dropdown } from 'antd'
import { CircleUserRound, LayoutDashboard, LogIn, LogOut, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { ApiClientError, apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

export function AccountNav({ compact = false }: { compact?: boolean }) {
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
        {compact ? null : '登录'}
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
      menu={{
        items: [
          {
            key: 'account',
            icon: <CircleUserRound size={15} />,
            label: <Link href="/account">账户中心</Link>,
          },
          {
            key: 'profile',
            icon: <UserRound size={15} />,
            label: <Link href={`/u/${user.username}`}>个人主页</Link>,
          },
          ...(user.role === 'ADMIN'
            ? [{
                key: 'admin',
                icon: <LayoutDashboard size={15} />,
                label: <Link href="/admin/mm">管理后台</Link>,
              }]
            : []),
          { type: 'divider' as const },
          {
            key: 'logout',
            icon: <LogOut size={15} />,
            label: '退出登录',
            onClick: () => void logout(),
          },
        ],
      }}
    >
      <Button icon={<CircleUserRound size={16} />}>
        {compact ? null : user.displayName || user.username}
      </Button>
    </Dropdown>
  )
}
