import { ProjectHomePage } from '@/components/pages/project-home-page'

export default async function Page({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ProjectHomePage projectId={id} />
}
