import { NoteContentEditor } from '@/components/admin/note-content-editor'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminNoteContent')
}

export default async function NoteContentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <NoteContentEditor key={id} noteId={id} />
}
