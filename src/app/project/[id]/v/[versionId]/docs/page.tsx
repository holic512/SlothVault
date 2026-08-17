import type { Metadata } from 'next'

import { redirect } from 'next/navigation'

import { createPageMetadata } from '@/i18n/metadata'
import { getCachedProjectShell, getCachedProjectSidebar } from '@/server/services/public-project-cache'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>
}): Promise<Metadata> {
  const { id } = await params
  const { project } = await getCachedProjectShell(Number(id))
  return createPageMetadata('projectDocs', { projectName: project.projectName })
}

export default async function VersionDocsPage({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>
}) {
  const { id, versionId } = await params
  const sidebar = await getCachedProjectSidebar(Number(id), Number(versionId))
  const firstNote = sidebar.flatMap((category) => category.notes)[0]
  if (firstNote) redirect(`/project/${id}/v/${versionId}/docs/${firstNote.id}`)

  return (
    <main className="project-reading-main">
      <div className="content-container content-container--reading">
        <h1>No published notes</h1>
      </div>
    </main>
  )
}
