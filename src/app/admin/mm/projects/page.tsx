import type { Metadata } from 'next'

import { ProjectsManager } from '@/components/admin/projects-manager'

export const metadata: Metadata = { title: 'Project Management' }

export default function ProjectsPage() {
  return <ProjectsManager />
}
