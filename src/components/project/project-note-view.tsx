'use client'

import { useQuery } from '@tanstack/react-query'
import { Alert, Skeleton, Typography } from 'antd'
import Link from 'next/link'

import { MarkdownView } from '@/components/markdown/markdown-view'
import { useProjectContext } from '@/components/project/project-context'
import { apiFetch } from '@/lib/api-client'
import type { SidebarCategory } from '@/components/project/version-docs-redirect'

type NoteData = {
  id: string
  noteId: string
  noteTitle: string
  content: string
  versionNote: string | null
  updatedAt: string
}

export function ProjectNoteView({ versionId, noteId }: { versionId: string; noteId: string }) {
  const { projectId, accessHeaders } = useProjectContext()
  const sidebarQuery = useQuery({
    queryKey: ['project-sidebar', projectId, versionId],
    queryFn: () =>
      apiFetch<SidebarCategory[]>(`/api/project/${projectId}/v/${versionId}/sidebar`, {
        headers: accessHeaders,
      }),
  })
  const noteQuery = useQuery({
    queryKey: ['project-note', projectId, versionId, noteId],
    queryFn: () =>
      apiFetch<NoteData>(`/api/project/${projectId}/v/${versionId}/note/${noteId}`, {
        headers: accessHeaders,
      }),
  })

  if (sidebarQuery.isError || noteQuery.isError) {
    return (
      <div className="project-route-loading">
        <Alert type="error" showIcon message={(sidebarQuery.error || noteQuery.error)?.message} />
      </div>
    )
  }

  return (
    <main className="docs-reader">
      <aside className="docs-sidebar">
        {sidebarQuery.isLoading ? <Skeleton active /> : null}
        {sidebarQuery.data?.map((category) => (
          <section key={category.id} className="docs-category">
            <Typography.Text>{category.categoryName}</Typography.Text>
            <nav>
              {category.notes.map((note) => (
                <Link
                  key={note.id}
                  className={note.id === noteId ? 'is-active' : ''}
                  href={`/project/${projectId}/v/${versionId}/docs/${note.id}`}
                >
                  {note.noteTitle}
                </Link>
              ))}
            </nav>
          </section>
        ))}
      </aside>
      <article className="docs-article">
        {noteQuery.isLoading ? <Skeleton active paragraph={{ rows: 15 }} /> : null}
        {noteQuery.data ? (
          <>
            <header className="docs-article-header">
              <Typography.Text type="secondary">Updated {new Date(noteQuery.data.updatedAt).toLocaleString()}</Typography.Text>
              <Typography.Title>{noteQuery.data.noteTitle}</Typography.Title>
              {noteQuery.data.versionNote ? <Typography.Paragraph type="secondary">{noteQuery.data.versionNote}</Typography.Paragraph> : null}
            </header>
            <MarkdownView content={noteQuery.data.content} />
          </>
        ) : null}
      </article>
    </main>
  )
}
