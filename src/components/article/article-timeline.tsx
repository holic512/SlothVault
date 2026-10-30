/**
 * @file article-timeline.tsx
 * @project SlothVault
 * @module Public Article Timeline
 * @description Displays monthly article groups and appends older articles during scrolling.
 * @logic Keep loaded entries in place, load one batch at a time, and offer manual loading and retry with accessible status updates.
 * @dependencies React, next-intl, Next Link, public articles API, ArticleCover
 * @index_tags article,timeline,scroll,archive,accessibility
 * @author holic512
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { ArrowUpRight, LockKeyhole } from 'lucide-react'

import { ArticleCover } from '@/components/article/article-cover'

export type PublicArticleListItem = {
  id: string
  title: string
  summary: string
  cover: string | null
  publishedAt: string
  updatedAt: string
  allowedMembershipLevels: Array<{ id: string; name: string; rank: number; status: number }>
}

export function ArticleTimeline({ initialArticles, totalPages }: {
  initialArticles: PublicArticleListItem[]
  totalPages: number
}) {
  const t = useTranslations('ArticlesPage')
  const locale = useLocale() === 'zh' ? 'zh-CN' : 'en-US'
  const [articles, setArticles] = useState(initialArticles)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(totalPages > 1)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore) return
    busy.current = true
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/articles?page=${page + 1}`)
      if (!response.ok) throw new Error('Article request failed')
      const result = await response.json() as {
        code: number
        data: { list: PublicArticleListItem[]; totalPages: number }
      }
      if (result.code !== 0) throw new Error('Article request failed')
      setArticles((current) => {
        const ids = new Set(current.map((article) => article.id))
        return [...current, ...result.data.list.filter((article) => !ids.has(article.id))]
      })
      setPage(page + 1)
      setHasMore(result.data.list.length > 0 && page + 1 < result.data.totalPages)
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [hasMore, page])

  useEffect(() => {
    if (!hasMore || loading || failed || !sentinel.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore()
    }, { rootMargin: '240px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [hasMore, loading, failed, loadMore])

  const groups = new Map<string, PublicArticleListItem[]>()
  for (const article of articles) {
    const month = article.publishedAt.slice(0, 7)
    const group = groups.get(month) ?? []
    group.push(article)
    groups.set(month, group)
  }
  const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  })

  if (!articles.length) return (
    <section className="articles-empty">
      <h2>{t('emptyTitle')}</h2>
      <p>{t('emptyDescription')}</p>
    </section>
  )

  return (
    <div className="article-archive-layout">
      <nav className="article-month-nav" aria-label={t('timeline')}>
        <span>{t('timeline')}</span>
        {Array.from(groups.keys(), (month) => (
          <a key={month} href={`#articles-${month}`}>{monthLabel(month)}</a>
        ))}
      </nav>
      <div className="article-timeline">
        {Array.from(groups, ([month, entries]) => (
          <section key={month} id={`articles-${month}`} className="article-month" aria-labelledby={`heading-${month}`}>
            <h2 id={`heading-${month}`} className="article-month-heading">{monthLabel(month)}</h2>
            <ol className="article-timeline-list">
              {entries.map((article) => (
                <li key={article.id} className="article-timeline-item">
                  <article>
                    <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString(locale, {
                      month: 'short', day: 'numeric', timeZone: 'UTC',
                    })}</time>
                    <Link href={`/articles/${article.id}`} className="article-entry-link">
                      <div className="article-entry-copy">
                        <h3>{article.title}</h3>
                        {article.summary ? <p>{article.summary}</p> : null}
                        <div className="article-entry-meta">
                          {article.allowedMembershipLevels.length ? (
                            <span className="article-membership-badge"><LockKeyhole size={13} aria-hidden="true" />{t('requiredLevel', {
                              level: article.allowedMembershipLevels.map((item) => item.name).join(' / '),
                            })}</span>
                          ) : null}
                          <span className="article-read-action">{t('read')}<ArrowUpRight size={14} aria-hidden="true" /></span>
                        </div>
                      </div>
                      {article.cover ? <ArticleCover cover={article.cover} title={article.title} className="article-entry-cover" /> : null}
                    </Link>
                  </article>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <div className="article-load-more" ref={sentinel}>
          <p role="status" aria-live="polite">{failed ? t('loadError') : loading ? t('loading') : hasMore ? t('scrollHint') : t('end')}</p>
          {hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loading}>{failed ? t('retry') : t('loadMore')}</button> : null}
        </div>
      </div>
    </div>
  )
}
