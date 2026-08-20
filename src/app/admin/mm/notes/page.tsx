import { NoteContentEditor } from '@/components/admin/note-content-editor'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminNotes')
}

export default function NotesPage() {
  return <NoteContentEditor />
}
