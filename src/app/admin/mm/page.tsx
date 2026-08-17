import { DashboardView } from '@/components/admin/dashboard-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminDashboard')
}

export default function AdminDashboardPage() {
  return <DashboardView />
}
