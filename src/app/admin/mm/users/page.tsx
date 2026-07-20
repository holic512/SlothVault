import type { Metadata } from 'next'

import { UsersManager } from '@/components/admin/users-manager'

export const metadata: Metadata = { title: '用户管理' }

export default function UsersPage() {
  return <UsersManager />
}
