/**
 * @file public-article-cache.ts
 * @project SlothVault
 * @module Public Article Cache
 * @description Adds a short shared Next.js data cache for the independent public blog archive and article details.
 * @logic Serialize dates at the cache boundary, cache list pages and details for one minute, and expose one tag invalidation entry for administrator mutations.
 * @dependencies next/cache, public-articles service
 * @index_tags article,blog,cache,revalidate,public
 * @author holic512
 */
import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'

import { getPublicArticle, listPublicArticles } from '@/server/services/public-articles'

const PUBLIC_ARTICLE_REVALIDATE_SECONDS = 60
export const PUBLIC_ARTICLES_CACHE_TAG = 'public-articles'

export function publicArticleCacheTag(articleId: number) {
  return `public-article:${articleId}`
}

export async function invalidatePublicArticleCache(articleId?: number) {
  revalidateTag(PUBLIC_ARTICLES_CACHE_TAG, { expire: 0 })
  if (articleId !== undefined) revalidateTag(publicArticleCacheTag(articleId), { expire: 0 })
}

function iso(value: Date) {
  return value.toISOString()
}

export function getCachedPublicArticleList(page: number) {
  return unstable_cache(
    async () => {
      const result = await listPublicArticles(page)
      return {
        ...result,
        list: result.list.map((article) => ({
          ...article,
          publishedAt: iso(article.publishedAt),
          updatedAt: iso(article.updatedAt),
        })),
      }
    },
    ['public-article-list', String(page)],
    { revalidate: PUBLIC_ARTICLE_REVALIDATE_SECONDS, tags: [PUBLIC_ARTICLES_CACHE_TAG] },
  )()
}

export function getCachedPublicArticle(articleId: number) {
  return unstable_cache(
    async () => {
      const article = await getPublicArticle(articleId)
      return {
        ...article,
        publishedAt: iso(article.publishedAt),
        updatedAt: iso(article.updatedAt),
      }
    },
    ['public-article', String(articleId)],
    {
      revalidate: PUBLIC_ARTICLE_REVALIDATE_SECONDS,
      tags: [PUBLIC_ARTICLES_CACHE_TAG, publicArticleCacheTag(articleId)],
    },
  )()
}
