import { VersionDocsRedirect } from '@/components/project/version-docs-redirect'

export default async function VersionDocsPage({
  params,
}: {
  params: Promise<{ versionId: string }>
}) {
  const { versionId } = await params
  return <VersionDocsRedirect versionId={versionId} />
}
