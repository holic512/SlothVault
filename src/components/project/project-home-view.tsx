import { MarkdownView } from '@/components/markdown/markdown-view'

type HomeData = { id: string; projectId: string; content: string; updatedAt: string }

export function ProjectHomeView({ home }: { home: HomeData }) {
  return (
    <main className="project-reading-main">
      <div className="content-container content-container--reading">
        <MarkdownView content={home.content} className="project-home-markdown" />
      </div>
    </main>
  )
}
