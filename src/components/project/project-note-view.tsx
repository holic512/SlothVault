/**
 * @file project-note-view.tsx
 * @project SlothVault
 * @module Public Article Reader
 * @description Renders immutable public Markdown releases with navigation, manifest identity, authorship, and version-level transaction evidence.
 * @logic Display the release hash and one shared evidence receipt set for every article in the version, clearly distinguishing Mainnet formal records from Devnet tests.
 * @dependencies next-intl/server, MarkdownView
 * @index_tags article,reader,release,evidence,transaction,public
 * @author holic512
 */
import { Typography } from 'antd'
import { BadgeCheck, Download, ExternalLink, Fingerprint, FlaskConical, UserRound } from 'lucide-react'
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
  evidence: Array<{
    transactionSignature: string
    signerAddress: string
    network: string
    finalizedAt: string
  }>
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
          {note.evidence.map((credential) => (
            <aside className="docs-copyright-proof" aria-label="版本交易存证" key={credential.transactionSignature}>
              <span className="docs-copyright-mark">
                {credential.network === 'devnet' ? <FlaskConical size={18} /> : <BadgeCheck size={18} />}
              </span>
              <div className="docs-copyright-copy">
                <strong>{credential.network === 'devnet' ? '测试存证 · Devnet' : '正式存证 · Mainnet'}</strong>
                <span>签名钱包已对本版本完整哈希进行 Solana Memo 存证。</span>
                <code title={credential.transactionSignature}>
                  {credential.transactionSignature.slice(0, 12)}…{credential.transactionSignature.slice(-8)}
                </code>
              </div>
              <div className="docs-copyright-links">
                <Link href={`/evidence/${credential.transactionSignature}`}>
                  核验凭证<ExternalLink size={12} />
                </Link>
              </div>
            </aside>
          ))}
        </header>
        <MarkdownView content={note.content} />
      </article>
    </main>
  )
}
