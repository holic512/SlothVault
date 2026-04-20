import { ProjectNotePage } from '@/components/pages/project-note-page'

export default async function Page({
  params
}: {
  params: Promise<{ id: string; versionId: string; noteId: string }>
}) {
  const { id, versionId, noteId } = await params
  return <ProjectNotePage projectId={id} versionId={versionId} noteId={noteId} />
}
