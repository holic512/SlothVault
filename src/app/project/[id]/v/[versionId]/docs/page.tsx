import { ProjectVersionDocsPage } from '@/components/pages/project-version-docs-page'

export default async function Page({
  params
}: {
  params: Promise<{ id: string; versionId: string }>
}) {
  const { id, versionId } = await params
  return <ProjectVersionDocsPage projectId={id} versionId={versionId} />
}
