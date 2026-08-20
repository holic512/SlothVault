/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Article Archive Page
 * @description Serves the paginated independent blog archive in the shared public portal.
 * @logic Normalize the page query, read cached public articles and branding concurrently, and delegate the editorial layout to the archive view.
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

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const query = await searchParams
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page
  const parsedPage = Number(rawPage)
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const [result, branding] = await Promise.all([
    getCachedPublicArticleList(page),
    getSystemBranding(),
  ])

  return <PublicArticleListView {...result} articles={result.list} branding={branding} />
}
