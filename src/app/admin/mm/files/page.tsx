import { FilesManager } from '@/components/admin/files-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminFiles')
}

export default function FilesPage() {
  return <FilesManager />
}
