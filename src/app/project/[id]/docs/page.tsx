import { ProjectDocsEntryPage } from '@/components/pages/project-docs-entry-page'

export default async function Page({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ProjectDocsEntryPage projectId={id} />
}
