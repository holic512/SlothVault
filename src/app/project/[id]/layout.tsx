import type { Metadata } from 'next'

import { ProjectShell } from '@/components/project/project-shell'
import { createPageMetadata } from '@/i18n/metadata'
import { getCachedProjectShell } from '@/server/services/public-project-cache'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const { project } = await getCachedProjectShell(Number(id))
  return createPageMetadata('projectHome', { projectName: project.projectName })
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const projectId = Number(id)
  const { project, versions, menus } = await getCachedProjectShell(projectId)
  return (
    <ProjectShell projectId={id} project={project} versions={versions} menus={menus}>
      {children}
    </ProjectShell>
  )
}
