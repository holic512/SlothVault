import { SettingsManager } from '@/components/admin/settings-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminSettings')
}

export default function SettingsPage() {
  return <SettingsManager />
}
