/**
 * @file project-note-view.tsx
 * @project SlothVault
 * @module Public Project Document Reader
 * @description Renders immutable public project documents with navigation, exact content-version evidence, and legacy release evidence.
 * @logic Keep public project reading independent from user identity while displaying content evidence for the selected primary revision and legacy release receipts.
 * @dependencies Ant Design Typography, next-intl/server, MarkdownView
 * @index_tags project,document,reader,release,evidence,transaction,public
 * @author holic512
 */
import TypographyParagraph from 'antd/es/typography/Paragraph'
import TypographyText from 'antd/es/typography/Text'
import TypographyTitle from 'antd/es/typography/Title'
import { BadgeCheck, Download, ExternalLink, Fingerprint, FlaskConical } from 'lucide-react'
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
  evidence: Array<{
    transactionSignature: string
    signerAddress: string
    network: string
    finalizedAt: string
  }>
  noteEvidence: Array<{
    transactionSignature: string
    signerAddress: string
    network: string
    contentHash: string
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
  const [locale, t] = await Promise.all([getLocale(), getTranslations('ProjectDocument')])

  return (
    <main className="docs-reader">
      <aside className="docs-sidebar">
        {sidebar.map((category) => (
          <section key={category.id} className="docs-category">
            <TypographyText>{category.categoryName}</TypographyText>
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
            <span>
              {t('updated', {
                date: new Date(note.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US'),
              })}
            </span>
          </div>
          <TypographyTitle>{note.noteTitle}</TypographyTitle>
          {note.versionNote ? <TypographyParagraph type="secondary">{note.versionNote}</TypographyParagraph> : null}
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
            <aside className="docs-copyright-proof" aria-label={t('evidence.release.label')} key={credential.transactionSignature}>
              <span className="docs-copyright-mark">
                {credential.network === 'devnet' ? <FlaskConical size={18} /> : <BadgeCheck size={18} />}
              </span>
              <div className="docs-copyright-copy">
                <strong>{credential.network === 'devnet' ? t('evidence.release.devnet') : t('evidence.release.mainnet')}</strong>
                <span>{t('evidence.release.description')}</span>
                <code title={credential.transactionSignature}>
                  {credential.transactionSignature.slice(0, 12)}…{credential.transactionSignature.slice(-8)}
                </code>
              </div>
              <div className="docs-copyright-links">
                <Link href={`/evidence/${credential.transactionSignature}`}>
                  {t('evidence.verify')}<ExternalLink size={12} />
                </Link>
              </div>
            </aside>
          ))}
          {note.noteEvidence.map((credential) => (
            <aside className="docs-copyright-proof" aria-label={t('evidence.content.label')} key={credential.transactionSignature}>
              <span className="docs-copyright-mark">
                {credential.network === 'devnet' ? <FlaskConical size={18} /> : <BadgeCheck size={18} />}
              </span>
              <div className="docs-copyright-copy">
                <strong>{credential.network === 'devnet' ? t('evidence.content.devnet') : t('evidence.content.mainnet')}</strong>
                <span>{t('evidence.content.description')}</span>
                <code title={credential.contentHash}>{credential.contentHash}</code>
              </div>
              <div className="docs-copyright-links">
                <Link href={`/evidence/${credential.transactionSignature}`}>
                  {t('evidence.verify')}<ExternalLink size={12} />
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
