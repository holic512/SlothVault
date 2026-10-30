import { resolveProjectPageParams } from '@/server/services/public-content-ids'
import { redirect } from 'next/navigation'

import { getCachedProjectVersions } from '@/server/services/public-project-cache'

export default async function ProjectDocsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const resolved = await resolveProjectPageParams({ id })
  const versions = await getCachedProjectVersions(resolved.projectId)
  if (versions[0]) redirect(`/project/${id}/v/${versions[0].id}/docs`)

  return (
    <main className="project-reading-main">
      <div className="content-container content-container--reading">
        <h1>No published version</h1>
        <p>Publish a project version before opening docs.</p>
      </div>
    </main>
  )
}
