import { ProjectHomeView } from '@/components/project/project-home-view'
import { getCachedProjectHome } from '@/server/services/public-project-cache'

export default async function ProjectHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const home = await getCachedProjectHome(Number(id))
  return <ProjectHomeView home={home} />
}
