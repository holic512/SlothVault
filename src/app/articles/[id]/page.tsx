/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Independent Article Page
 * @description Serves one published standalone blog article with dynamic metadata and a real 404 for hidden content.
 * @logic Validate the decimal route ID, resolve the cached public record, translate domain misses into Next.js not-found behavior, and render the public reader.
 * @dependencies Next metadata/navigation, public article cache, PublicArticleReaderView
 * @index_tags article,blog,detail,page,public
 * @author holic512
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PublicArticleReaderView } from '@/components/article/public-article-reader-view'
import { createPageMetadata } from '@/i18n/metadata'
import { HttpError } from '@/server/http/errors'
import { getCachedPublicArticle } from '@/server/services/public-article-cache'
import { getSystemBranding } from '@/server/services/system-branding'

function articleId(value: string) {
  if (!/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function resolveArticle(value: string) {
  const id = articleId(value)
  if (!id) return null
  try {
    return await getCachedPublicArticle(id)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null
    throw error
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const article = await resolveArticle(id)
  if (!article) return createPageMetadata('articles')
  return {
    ...(await createPageMetadata('article', { title: article.title })),
    description: article.summary || undefined,
  }
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const article = await resolveArticle(id)
  if (!article) notFound()

  return (
    <PublicArticleReaderView
      article={article}
      branding={await getSystemBranding()}
    />
  )
}
