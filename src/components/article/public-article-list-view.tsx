/**
 * @file public-article-list-view.tsx
 * @project SlothVault
 * @module Public Article Archive View
 * @description Renders a cover-led editorial archive with a featured lead story and compact responsive article cards.
 * @logic Promote the first article on the current page, preserve chronological numbering, provide cover fallbacks, and expose simple canonical pagination.
 * @dependencies Next links, next-intl/server, ArticleCover, PublicNavbar
 * @index_tags article,archive,editorial,public,responsive
 * @author holic512
 */
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { ArticleCover } from '@/components/article/article-cover'
import { PublicNavbar } from '@/components/shell/public-navbar'
import publicStyles from '@/styles/modules/public.module.css'
import type { SystemBranding } from '@/types/branding'

type PublicArticleListItem = {
  id: string
  title: string
  summary: string
  cover: string | null
  publishedAt: string
  updatedAt: string
}

export async function PublicArticleListView({
  articles,
  page,
  total,
  totalPages,
  branding,
}: {
  articles: PublicArticleListItem[]
  page: number
  total: number
  totalPages: number
  branding: SystemBranding
}) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('ArticlesPage')])
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'
  const [featured, ...rest] = articles
  const numberOffset = (page - 1) * 12

  return (
    <div className={`${publicStyles.root} public-page articles-page`}>
      <PublicNavbar branding={branding} />
      <main className="articles-main content-container">
        <header className="articles-masthead">
          <div>
            <span className="articles-kicker">Journal / {new Date().getFullYear()}</span>
            <h1>{t('title')}</h1>
          </div>
          <p>{t('description')}</p>
          <span className="articles-count">{t('count', { count: total })}</span>
        </header>

        {featured ? (
          <>
            <Link href={`/articles/${featured.id}`} className="article-feature-link">
              <article className="article-feature">
                <ArticleCover cover={featured.cover} title={featured.title} className="article-feature-cover" eager />
                <div className="article-feature-copy">
                  <div className="article-card-folio">
                    <span>{String(numberOffset + 1).padStart(2, '0')}</span>
                    <time>{new Date(featured.publishedAt).toLocaleDateString(dateLocale)}</time>
                  </div>
                  <h2>{featured.title}</h2>
                  <p>{featured.summary}</p>
                  <span className="article-read-action">{t('read')}<ArrowUpRight size={16} /></span>
                </div>
              </article>
            </Link>

            {rest.length ? (
              <div className="article-grid">
                {rest.map((article, index) => (
                  <Link key={article.id} href={`/articles/${article.id}`} className="article-card-link">
                    <article className="article-card">
                      <ArticleCover cover={article.cover} title={article.title} className="article-card-cover" />
                      <div className="article-card-copy">
                        <div className="article-card-folio">
                          <span>{String(numberOffset + index + 2).padStart(2, '0')}</span>
                          <time>{new Date(article.publishedAt).toLocaleDateString(dateLocale)}</time>
                        </div>
                        <h2>{article.title}</h2>
                        <p>{article.summary}</p>
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <section className="articles-empty">
            <span>00</span>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyDescription')}</p>
          </section>
        )}

        {totalPages > 1 ? (
          <nav className="article-pagination" aria-label={t('pagination')}>
            {page > 1 ? (
              <Link href={page === 2 ? '/articles' : `/articles?page=${page - 1}`}>
                <ChevronLeft size={15} />{t('previous')}
              </Link>
            ) : <span />}
            <strong>{page} / {totalPages}</strong>
            {page < totalPages ? (
              <Link href={`/articles?page=${page + 1}`}>
                {t('next')}<ChevronRight size={15} />
              </Link>
            ) : <span />}
          </nav>
        ) : null}
      </main>
    </div>
  )
}
