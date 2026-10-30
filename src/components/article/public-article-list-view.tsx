/**
 * @file public-article-list-view.tsx
 * @project SlothVault
 * @module Public Article Archive View
 * @description Serves a quiet chronological article archive within the public shell.
 * @logic Render the initial archive on the server and delegate continuous browsing to the timeline.
 * @dependencies ArticleTimeline, PublicNavbar, SystemFilingFooter
 * @index_tags article,archive,timeline,public
 * @author holic512
 */
import { getTranslations } from 'next-intl/server'

import { ArticleTimeline, type PublicArticleListItem } from '@/components/article/article-timeline'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
import publicStyles from '@/styles/modules/public.module.css'
import type { SystemBranding } from '@/types/branding'

export async function PublicArticleListView({ articles, total, totalPages, branding }: {
  articles: PublicArticleListItem[]
  total: number
  totalPages: number
  branding: SystemBranding
}) {
  const t = await getTranslations('ArticlesPage')

  return (
    <div className={`${publicStyles.root} public-page articles-page`}>
      <PublicNavbar branding={branding} />
      <main className="articles-main content-container">
        <header className="public-list-heading">
          <div>
            <h1>{t('title')}</h1>
            <p>{t('description')}</p>
          </div>
          <span className="public-list-count">{t('count', { count: total })}</span>
        </header>
        <ArticleTimeline initialArticles={articles} totalPages={totalPages} />
      </main>
      <SystemFilingFooter />
    </div>
  )
}
