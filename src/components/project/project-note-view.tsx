'use client'

/**
 * @file project-note-view.tsx
 * @project SlothVault
 * @module Public Article Reader
 * @description Renders public Markdown articles with navigation, administrator authorship, and optional on-chain copyright proof.
 * @logic Load the published article without identity gates, link its author profile, and expose safe Solana Explorer evidence without turning certificates into access controls.
 * @dependencies React Query, next-intl, project context, MarkdownView, public project API
 * @index_tags article,reader,author,copyright,certificate,public
 * @author holic512
 */
import { useQuery } from '@tanstack/react-query'
import { Alert, Skeleton, Typography } from 'antd'
import { BadgeCheck, ExternalLink, UserRound } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
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
  author: {
    username: string
    displayName: string | null
  } | null
  certificate: {
    assetId: string
    transaction: string | null
    ownerAddress: string
    network: string
    issuedAt: string
  } | null
}

function explorerUrl(kind: 'address' | 'tx', value: string, network: string) {
  const url = new URL(`https://explorer.solana.com/${kind}/${encodeURIComponent(value)}`)
  if (network === 'devnet') url.searchParams.set('cluster', 'devnet')
  return url.toString()
}

export function ProjectNoteView({ versionId, noteId }: { versionId: string; noteId: string }) {
  const { projectId } = useProjectContext()
  const locale = useLocale()
  const t = useTranslations('Article')
  const sidebarQuery = useQuery({
    queryKey: ['project-sidebar', projectId, versionId],
    queryFn: () =>
      apiFetch<SidebarCategory[]>(`/api/project/${projectId}/v/${versionId}/sidebar`),
  })
  const noteQuery = useQuery({
    queryKey: ['project-note', projectId, versionId, noteId],
    queryFn: () =>
      apiFetch<NoteData>(`/api/project/${projectId}/v/${versionId}/note/${noteId}`),
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
              <div className="docs-article-meta">
                {noteQuery.data.author ? (
                  <Link href={`/u/${noteQuery.data.author.username}`} className="docs-author-link">
                    <UserRound size={14} />
                    {noteQuery.data.author.displayName || noteQuery.data.author.username}
                  </Link>
                ) : (
                  <span>{t('unknownAuthor')}</span>
                )}
                <span>
                  {t('updated', {
                    date: new Date(noteQuery.data.updatedAt).toLocaleString(
                      locale === 'zh' ? 'zh-CN' : 'en-US',
                    ),
                  })}
                </span>
              </div>
              <Typography.Title>{noteQuery.data.noteTitle}</Typography.Title>
              {noteQuery.data.versionNote ? <Typography.Paragraph type="secondary">{noteQuery.data.versionNote}</Typography.Paragraph> : null}
              {noteQuery.data.certificate ? (
                <aside className="docs-copyright-proof" aria-label={t('certificate.title')}>
                  <span className="docs-copyright-mark"><BadgeCheck size={18} /></span>
                  <div className="docs-copyright-copy">
                    <strong>{t('certificate.title')}</strong>
                    <span>{t('certificate.description')}</span>
                    <code title={noteQuery.data.certificate.assetId}>
                      {noteQuery.data.certificate.assetId.slice(0, 12)}…{noteQuery.data.certificate.assetId.slice(-8)}
                    </code>
                  </div>
                  <div className="docs-copyright-links">
                    <a
                      href={explorerUrl('address', noteQuery.data.certificate.assetId, noteQuery.data.certificate.network)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('certificate.asset')}<ExternalLink size={12} />
                    </a>
                    {noteQuery.data.certificate.transaction ? (
                      <a
                        href={explorerUrl('tx', noteQuery.data.certificate.transaction, noteQuery.data.certificate.network)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('certificate.transaction')}<ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                </aside>
              ) : null}
            </header>
            <MarkdownView content={noteQuery.data.content} />
          </>
        ) : null}
      </article>
    </main>
  )
}
