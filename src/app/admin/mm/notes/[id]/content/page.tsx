import type { Metadata } from 'next'

import { NoteContentEditor } from '@/components/admin/note-content-editor'

export const metadata: Metadata = { title: 'Content Editor' }

export default async function NoteContentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <NoteContentEditor key={id} noteId={id} />
}
