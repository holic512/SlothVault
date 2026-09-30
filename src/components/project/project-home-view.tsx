import { MarkdownView } from '@/components/markdown/markdown-view'

type HomeData = { id: string; projectId: string; content: string; updatedAt: string }

export function ProjectHomeView({ home }: { home: HomeData }) {
  return (
    <main className="project-home-main">
      <div className="project-home-container">
        <MarkdownView content={home.content} className="project-home-markdown" presentation="landing" />
      </div>
    </main>
  )
}
