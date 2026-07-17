import type { Metadata } from 'next'

import { ProjectListView } from '@/components/project/project-list-view'

export const metadata: Metadata = { title: 'Projects' }

export default function ProjectListPage() {
  return <ProjectListView />
}
