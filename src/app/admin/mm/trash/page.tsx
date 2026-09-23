import { TrashManager } from '@/components/admin/trash-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminTrash')
}

export default function AdminTrashPage() {
  return <TrashManager />
}
