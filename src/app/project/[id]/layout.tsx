import { ProjectShell } from '@/components/project/project-shell'
import { getCachedProjectShell } from '@/server/services/public-project-cache'

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
