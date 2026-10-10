/**
 * @file page.tsx
 * @project SlothVault
 * @module Project Document Route
 * @description Keeps navigation and titles visible while loading protected document bodies only for authorized readers.
 * @logic Read public metadata separately, resolve the current session and project policy, then render a body or membership notice.
 * @dependencies viewer, content-access, public-projects, public-project-cache, ProjectNoteView
 * @index_tags project,read,download,membership,server-rendering,metadata
 * @author holic512
 */
import type { Metadata } from 'next'
import { getPageViewer } from '@/server/auth/viewer'
import { resolveProjectAccess } from '@/server/services/content-access'
import { getProjectNoteMetadata } from '@/server/services/public-projects'

import { ProjectNoteView } from '@/components/project/project-note-view'
import { createPageMetadata } from '@/i18n/metadata'
import {
  getCachedProjectNote,
  getCachedProjectShell,
  getCachedProjectSidebar,
} from '@/server/services/public-project-cache'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; versionId: string; noteId: string }>
}): Promise<Metadata> {
  const { id, versionId, noteId } = await params
  const [projectShell, note] = await Promise.all([
    getCachedProjectShell(Number(id)),
    getProjectNoteMetadata(Number(id), Number(versionId), Number(noteId)),
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
  const viewer = await getPageViewer()
  const access = await resolveProjectAccess(projectId, viewer)
  const [sidebar, metadata] = await Promise.all([
    getCachedProjectSidebar(projectId, numericVersionId),
    getProjectNoteMetadata(projectId, numericVersionId, Number(noteId)),
  ])
  const note = access.canRead ? await getCachedProjectNote(projectId, numericVersionId, Number(noteId), viewer) : null
  return (
    <ProjectNoteView
      projectId={id}
      versionId={versionId}
      noteId={noteId}
      sidebar={sidebar}
      note={note}
      noteTitle={metadata.noteTitle}
      tags={metadata.tags}
      access={access}
    />
  )
}
