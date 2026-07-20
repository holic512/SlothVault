'use client'

import { useQuery } from '@tanstack/react-query'
import { Alert, Skeleton } from 'antd'

import { MarkdownView } from '@/components/markdown/markdown-view'
import { useProjectContext } from '@/components/project/project-context'
import { apiFetch } from '@/lib/api-client'

type HomeData = { id: string; projectId: string; content: string; updatedAt: string }

export function ProjectHomeView() {
  const { projectId } = useProjectContext()
  const query = useQuery({
    queryKey: ['project-home', projectId],
    queryFn: () => apiFetch<HomeData>(`/api/project/${projectId}/home`),
  })

  return (
    <main className="project-reading-main">
      <div className="content-container content-container--reading">
        {query.isLoading ? <Skeleton active paragraph={{ rows: 12 }} /> : null}
        {query.isError ? <Alert type="error" showIcon message={query.error.message} /> : null}
        {query.data ? <MarkdownView content={query.data.content} className="project-home-markdown" /> : null}
      </div>
    </main>
  )
}
