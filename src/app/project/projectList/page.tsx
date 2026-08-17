import { ProjectListView } from '@/components/project/project-list-view'
import { createPageMetadata } from '@/i18n/metadata'
import { getCachedPublicProjectList } from '@/server/services/public-project-cache'
import { getSystemBranding } from '@/server/services/system-branding'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('projects')
}

export default async function ProjectListPage() {
  const [projects, branding] = await Promise.all([
    getCachedPublicProjectList(),
    getSystemBranding(),
  ])
  return <ProjectListView projects={projects} branding={branding} />
}
