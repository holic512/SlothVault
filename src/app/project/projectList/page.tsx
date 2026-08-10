import type { Metadata } from 'next'

import { ProjectListView } from '@/components/project/project-list-view'
import { getCachedPublicProjectList } from '@/server/services/public-project-cache'

export const metadata: Metadata = { title: 'Projects' }

export default async function ProjectListPage() {
  const projects = await getCachedPublicProjectList()
  return <ProjectListView projects={projects} />
}
