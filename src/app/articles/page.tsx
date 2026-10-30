/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Article Archive Page
 * @description Serves the continuous independent blog archive in the shared public portal.
 * @logic Read the first batch of cached articles and branding concurrently; the timeline appends older batches without navigation.
 * @dependencies public article cache, system branding, PublicArticleListView
 * @index_tags article,blog,archive,page,public
 * @author holic512
 */
import { PublicArticleListView } from '@/components/article/public-article-list-view'
import { createPageMetadata } from '@/i18n/metadata'
import { getCachedPublicArticleList } from '@/server/services/public-article-cache'
import { getSystemBranding } from '@/server/services/system-branding'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('articles')
}

export default async function ArticlesPage() {
  const [result, branding] = await Promise.all([
    getCachedPublicArticleList(1),
    getSystemBranding(),
  ])

  return <PublicArticleListView {...result} articles={result.list} branding={branding} />
}
