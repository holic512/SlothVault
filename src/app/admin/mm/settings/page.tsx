import type { Metadata } from 'next'

import { SettingsManager } from '@/components/admin/settings-manager'

export const metadata: Metadata = { title: 'System Settings' }

export default function SettingsPage() {
  return <SettingsManager />
}
