import { ProjectListView } from '@/components/project/project-list-view'
import { createPageMetadata } from '@/i18n/metadata'
import { getCachedPublicProjectList } from '@/server/services/public-project-cache'

export async function generateMetadata() {
  return createPageMetadata('projects')
}

export default async function ProjectListPage() {
  const projects = await getCachedPublicProjectList()
  return <ProjectListView projects={projects} />
}
