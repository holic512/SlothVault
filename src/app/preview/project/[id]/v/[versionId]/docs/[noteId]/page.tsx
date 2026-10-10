/**
 * @file page.tsx
 * @project SlothVault
 * @module Preview Document Route
 * @description Renders a saved primary document in the project's administrator-only version preview.
 * @logic Authorize both metadata and content, verify ancestry, and preserve version-scoped directory links.
 * @dependencies project-preview, ProjectNoteView
 * @index_tags preview,document,permissions
 * @author holic512
 */
import type { Metadata } from 'next'
import { ProjectNoteView } from '@/components/project/project-note-view'
import { getPreviewNote, getPreviewSidebar, getPreviewVersion, previewAccess } from '@/server/services/project-preview'

type Props = { params: Promise<{ id: string; versionId: string; noteId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, versionId, noteId } = await params
  const note = await getPreviewNote(Number(id), Number(versionId), Number(noteId))
  return { title: note.noteTitle, robots: { index: false, follow: false } }
}

export default async function PreviewNotePage({ params }: Props) {
  const { id, versionId, noteId } = await params
  const [version, sidebar, note] = await Promise.all([
    getPreviewVersion(Number(id), Number(versionId)),
    getPreviewSidebar(Number(id), Number(versionId)),
    getPreviewNote(Number(id), Number(versionId), Number(noteId)),
  ])
  return <ProjectNoteView projectId={id} versionId={versionId} noteId={noteId} sidebar={sidebar} note={note} noteTitle={note.noteTitle} tags={note.tags} access={previewAccess(version.project)} previewBase={`/preview/project/${id}/v/${versionId}`} />
}
