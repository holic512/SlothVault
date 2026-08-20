/**
 * @file public-articles.ts
 * @project SlothVault
 * @module Public Independent Articles
 * @description Resolves the public blog archive and standalone article reader without project or user coupling.
 * @logic Expose only active published records, derive a compact plain-text summary when absent, and keep stable publication ordering.
 * @dependencies Prisma Article model, server/http/errors
 * @index_tags article,blog,public,archive,summary
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export const PUBLIC_ARTICLE_PAGE_SIZE = 12

export function articleSummary(content: string, maximum = 160) {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#~|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (plain.length <= maximum) return plain
  return `${plain.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`
}

function publicSummary(summary: string | null, content: string) {
  return summary?.trim() || articleSummary(content)
}

export async function listPublicArticles(page = 1) {
  const normalizedPage = Number.isSafeInteger(page) && page > 0 ? page : 1
  const where = {
    status: 1,
    isDeleted: false,
    publishedAt: { not: null },
  } as const
  const [total, list] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      skip: (normalizedPage - 1) * PUBLIC_ARTICLE_PAGE_SIZE,
      take: PUBLIC_ARTICLE_PAGE_SIZE,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        summary: true,
        cover: true,
        content: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
  ])

  return {
    list: list.map((article) => ({
      id: article.id.toString(),
      title: article.title,
      summary: publicSummary(article.summary, article.content),
      cover: article.cover,
      publishedAt: article.publishedAt!,
      updatedAt: article.updatedAt,
    })),
    page: normalizedPage,
    pageSize: PUBLIC_ARTICLE_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / PUBLIC_ARTICLE_PAGE_SIZE),
  }
}

export async function getPublicArticle(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError('Article not found', 404, 404)

  const article = await prisma.article.findFirst({
    where: {
      id,
      status: 1,
      isDeleted: false,
      publishedAt: { not: null },
    },
    select: {
      id: true,
      title: true,
      summary: true,
      cover: true,
      content: true,
      publishedAt: true,
      updatedAt: true,
    },
  })
  if (!article) throw new HttpError('Article not found', 404, 404)

  return {
    id: article.id.toString(),
    title: article.title,
    summary: publicSummary(article.summary, article.content),
    cover: article.cover,
    content: article.content,
    publishedAt: article.publishedAt!,
    updatedAt: article.updatedAt,
  }
}
