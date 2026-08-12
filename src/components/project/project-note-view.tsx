/**
 * @file project-note-view.tsx
 * @project SlothVault
 * @module Public Article Reader
 * @description Renders immutable public Markdown releases with navigation, manifest identity, administrator authorship, and optional on-chain copyright proof.
 * @logic Render resolved published content, display its full reproducible SHA-256 and publication time, link canonical manifest bytes, and expose optional Solana evidence without conflating either proof with access control.
 * @dependencies next-intl/server, MarkdownView
 * @index_tags article,reader,author,copyright,certificate,public
 * @author holic512
 */
import { Typography } from 'antd'
import { BadgeCheck, Download, ExternalLink, Fingerprint, UserRound } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { MarkdownView } from '@/components/markdown/markdown-view'

export type SidebarCategory = {
  id: string
  categoryName: string
  weight: number
  notes: Array<{ id: string; noteTitle: string; weight: number }>
}

type NoteData = {
  id: string
  noteId: string
  noteTitle: string
  content: string
  versionNote: string | null
  updatedAt: string
  releaseId: string
  releaseHash: string
  manifestVersion: number
  publishedAt: string
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

export async function ProjectNoteView({
  projectId,
  versionId,
  noteId,
  sidebar,
  note,
}: {
  projectId: string
  versionId: string
  noteId: string
  sidebar: SidebarCategory[]
  note: NoteData
}) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('Article')])

  return (
    <main className="docs-reader">
      <aside className="docs-sidebar">
        {sidebar.map((category) => (
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
        <header className="docs-article-header">
          <div className="docs-article-meta">
            {note.author ? (
              <Link href={`/u/${note.author.username}`} className="docs-author-link">
                <UserRound size={14} />
                {note.author.displayName || note.author.username}
              </Link>
            ) : (
              <span>{t('unknownAuthor')}</span>
            )}
            <span>
              {t('updated', {
                date: new Date(note.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US'),
              })}
            </span>
          </div>
          <Typography.Title>{note.noteTitle}</Typography.Title>
          {note.versionNote ? <Typography.Paragraph type="secondary">{note.versionNote}</Typography.Paragraph> : null}
          <aside className="docs-release-proof" aria-label={t('release.title')}>
            <span className="docs-copyright-mark"><Fingerprint size={18} /></span>
            <div className="docs-copyright-copy">
              <strong>{t('release.title')}</strong>
              <span>
                {t('release.published', {
                  date: new Date(note.publishedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US'),
                })}
              </span>
              <code title={note.releaseHash}>{note.releaseHash}</code>
              <span>{t('release.scope')}</span>
            </div>
            <div className="docs-copyright-links">
              <a href={`/api/project/${projectId}/v/${versionId}/manifest`} download>
                {t('release.download')}<Download size={12} />
              </a>
            </div>
          </aside>
          {note.certificate ? (
            <aside className="docs-copyright-proof" aria-label={t('certificate.title')}>
              <span className="docs-copyright-mark"><BadgeCheck size={18} /></span>
              <div className="docs-copyright-copy">
                <strong>{t('certificate.title')}</strong>
                <span>{t('certificate.description')}</span>
                <code title={note.certificate.assetId}>
                  {note.certificate.assetId.slice(0, 12)}…{note.certificate.assetId.slice(-8)}
                </code>
              </div>
              <div className="docs-copyright-links">
                <a
                  href={explorerUrl('address', note.certificate.assetId, note.certificate.network)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('certificate.asset')}<ExternalLink size={12} />
                </a>
                {note.certificate.transaction ? (
                  <a
                    href={explorerUrl('tx', note.certificate.transaction, note.certificate.network)}
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
        <MarkdownView content={note.content} />
      </article>
    </main>
  )
}
