import { UsersManager } from '@/components/admin/users-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminUsers')
}

export default function UsersPage() {
  return <UsersManager />
}
