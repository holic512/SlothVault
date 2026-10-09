/**
 * @file layout.tsx
 * @project SlothVault
 * @module Public Project Route Layout
 * @description Composes the public project navigation, reading routes, and database-backed filing footer.
 * @logic Resolve project metadata and menus on the server and pass a fresh server-rendered footer through the client shell slot.
 * @dependencies public-project-cache, ProjectShell, SystemFilingFooter, i18n metadata
 * @index_tags project,layout,public,filing,server-component
 * @author holic512
 */
import type { Metadata } from 'next'

import { ProjectShell } from '@/components/project/project-shell'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
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
    <ProjectShell projectId={id} project={project} versions={versions} menus={menus} footer={<SystemFilingFooter />}>
      {children}
    </ProjectShell>
  )
}
