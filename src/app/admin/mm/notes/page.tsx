import { NotesManager } from '@/components/admin/notes-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminNotes')
}

export default function NotesPage() {
  return <NotesManager />
}
