/**
 * @file page.tsx
 * @project SlothVault
 * @module Preview Project Homepage
 * @description Shows an enabled project homepage inside a fixed administrator version preview.
 * @logic Authorize the version and homepage, then render saved content or return to that version's documents.
 * @dependencies project-preview, ProjectHomeView, Next navigation
 * @index_tags preview,homepage,project
 * @author holic512
 */
import { redirect } from 'next/navigation'
import { ProjectHomeView } from '@/components/project/project-home-view'
import { getPreviewHome, getPreviewVersion, previewAccess } from '@/server/services/project-preview'

export default async function PreviewHomePage({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params
  const version = await getPreviewVersion(Number(id), Number(versionId))
  const home = await getPreviewHome(Number(id), Number(versionId))
  if (!home) redirect(`/preview/project/${id}/v/${versionId}/docs`)
  return <ProjectHomeView home={home} access={previewAccess(version.project)} />
}
