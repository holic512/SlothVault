import { BackupManager } from '@/components/admin/backup-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminBackup')
}

export default function BackupPage() {
  return <BackupManager />
}
