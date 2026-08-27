/**
 * @file public-article-reader-view.tsx
 * @project SlothVault
 * @module Public Independent Article Reader
 * @description Renders one standalone blog article with a restrained editorial hero and the shared safe Markdown reader.
 * @logic Present publication metadata and optional cover independently from project releases, then render the authoritative Markdown body.
 * @dependencies next-intl/server, ArticleCover, MarkdownView, PublicNavbar
 * @index_tags article,blog,reader,public,markdown
 * @author holic512
 */
import { ArrowLeft, Clock3, LockKeyhole } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { ArticleCover } from '@/components/article/article-cover'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { PublicNavbar } from '@/components/shell/public-navbar'
import publicStyles from '@/styles/modules/public.module.css'
import type { SystemBranding } from '@/types/branding'

export async function PublicArticleReaderView({
  article,
  branding,
}: {
  article: {
    id: string
    title: string
    summary: string
    cover: string | null
    content: string | null
    publishedAt: string
    updatedAt: string
    requiredMembershipLevel: { id: string; name: string; rank: number } | null
    locked: boolean
    viewerAuthenticated: boolean
  }
  branding: SystemBranding
}) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('ArticleDetail')])
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'

  return (
    <div className={`${publicStyles.root} public-page article-reader-page`}>
      <PublicNavbar branding={branding} />
      <main className="article-reader-main">
        <div className="content-container article-reader-shell">
          <Link href="/articles" className="article-reader-back">
            <ArrowLeft size={15} />{t('back')}
          </Link>
          <article>
            <header className={`article-reader-hero ${article.cover ? 'has-cover' : ''}`}>
              <div className="article-reader-heading">
                <span className="articles-kicker">Article / {article.id.padStart(3, '0')}</span>
                <h1>{article.title}</h1>
                {article.summary ? <p>{article.summary}</p> : null}
                <div className="article-reader-dates">
                  <span>{t('published', { date: new Date(article.publishedAt).toLocaleDateString(dateLocale) })}</span>
                  <span><Clock3 size={13} />{t('updated', { date: new Date(article.updatedAt).toLocaleDateString(dateLocale) })}</span>
                </div>
              </div>
              {article.cover ? <ArticleCover cover={article.cover} title={article.title} className="article-reader-cover" eager /> : null}
            </header>
            <div className="article-reader-body content-container--reading">
              {article.locked ? (
                <section className="article-membership-lock">
                  <LockKeyhole size={24} />
                  <h2>{t('lockedTitle')}</h2>
                  <p>{t('lockedDescription', { level: article.requiredMembershipLevel?.name || '' })}</p>
                  <Link href={article.viewerAuthenticated ? '/account/membership' : '/login'}>
                    {article.viewerAuthenticated ? t('membershipAction') : t('loginAction')}
                  </Link>
                </section>
              ) : <MarkdownView content={article.content || ''} />}
            </div>
          </article>
        </div>
      </main>
    </div>
  )
}
