import type { ProjectAccess } from '@/lib/content-access'
import { ProjectAccessNotice } from './project-access-notice'
import { MarkdownView } from '@/components/markdown/markdown-view'

type HomeData = { id: string; projectId: string; content: string; updatedAt: string }

export function ProjectHomeView({ home, access }: { home: HomeData; access: ProjectAccess }) {
  return (
    <main className="project-home-main">
      <div className="project-home-container">
        <ProjectAccessNotice access={access} capability={access.canRead ? 'download' : 'read'} />
        <MarkdownView content={home.content} projectId={home.projectId} canDownload={access.canDownload} className="project-home-markdown" presentation="landing" />
      </div>
    </main>
  )
}
