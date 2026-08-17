import type { Metadata } from 'next'

import { ProjectNoteView } from '@/components/project/project-note-view'
import { createPageMetadata } from '@/i18n/metadata'
import {
  getCachedProjectNote,
  getCachedProjectShell,
  getCachedProjectSidebar,
} from '@/server/services/public-project-cache'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; versionId: string; noteId: string }>
}): Promise<Metadata> {
  const { id, versionId, noteId } = await params
  const [projectShell, note] = await Promise.all([
    getCachedProjectShell(Number(id)),
    getCachedProjectNote(Number(id), Number(versionId), Number(noteId)),
  ])
  return createPageMetadata('projectNote', {
    noteTitle: note.noteTitle,
    projectName: projectShell.project.projectName,
  })
}

export default async function ProjectNotePage({
  params,
}: {
  params: Promise<{ id: string; versionId: string; noteId: string }>
}) {
  const { id, versionId, noteId } = await params
  const projectId = Number(id)
  const numericVersionId = Number(versionId)
  const [sidebar, note] = await Promise.all([
    getCachedProjectSidebar(projectId, numericVersionId),
    getCachedProjectNote(projectId, numericVersionId, Number(noteId)),
  ])
  return (
    <ProjectNoteView
      projectId={id}
      versionId={versionId}
      noteId={noteId}
      sidebar={sidebar}
      note={note}
    />
  )
}
