import { ProjectNoteView } from '@/components/project/project-note-view'

export default async function ProjectNotePage({
  params,
}: {
  params: Promise<{ versionId: string; noteId: string }>
}) {
  const { versionId, noteId } = await params
  return <ProjectNoteView versionId={versionId} noteId={noteId} />
}
