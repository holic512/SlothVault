import { ProjectNoteView } from '@/components/project/project-note-view'
import {
  getCachedProjectNote,
  getCachedProjectSidebar,
} from '@/server/services/public-project-cache'

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
