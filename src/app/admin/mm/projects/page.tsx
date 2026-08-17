import { ProjectsManager } from '@/components/admin/projects-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminProjects')
}

export default function ProjectsPage() {
  return <ProjectsManager />
}
