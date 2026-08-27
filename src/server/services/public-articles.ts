/**
 * @file public-articles.ts
 * @project SlothVault
 * @module Public Independent Articles
 * @description Resolves public article metadata and conditionally loads article bodies after membership authorization.
 * @logic Keep archive and detail metadata safe for shared caching, resolve membership only for a detail reader, and never select or return protected Markdown until the viewer is authorized.
 * @dependencies Prisma Article/MembershipLevel models, membership service, auth roles, server/http/errors
 * @index_tags article,blog,public,archive,membership,authorization,summary
 * @author holic512
 */
import 'server-only'

import { isAdminRole } from '@/server/auth/roles'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { getEffectiveMembership } from '@/server/services/membership'

export const PUBLIC_ARTICLE_PAGE_SIZE = 12

export type PublicArticleMetadata = {
  id: string
  title: string
  summary: string
  cover: string | null
  publishedAt: Date
  updatedAt: Date
  requiredMembershipLevel: { id: string; name: string; rank: number } | null
}

export type PublicArticleReader = PublicArticleMetadata & {
  content: string | null
  locked: boolean
  viewerAuthenticated: boolean
}

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

function requiredLevelDto(level: { id: number; name: string; rank: number } | null) {
  return level ? { id: level.id.toString(), name: level.name, rank: level.rank } : null
}

function publicArticleWhere(id?: number) {
  return {
    ...(id !== undefined ? { id } : {}),
    status: 1,
    isDeleted: false,
    publishedAt: { not: null },
  } as const
}

export async function listPublicArticles(page = 1) {
  const normalizedPage = Number.isSafeInteger(page) && page > 0 ? page : 1
  const where = publicArticleWhere()
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
        requiredMembershipLevel: { select: { id: true, name: true, rank: true } },
      },
    }),
  ])

  return {
    list: list.map((article): PublicArticleMetadata => ({
      id: article.id.toString(),
      title: article.title,
      summary: publicSummary(article.summary, article.content),
      cover: article.cover,
      publishedAt: article.publishedAt!,
      updatedAt: article.updatedAt,
      requiredMembershipLevel: requiredLevelDto(article.requiredMembershipLevel),
    })),
    page: normalizedPage,
    pageSize: PUBLIC_ARTICLE_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / PUBLIC_ARTICLE_PAGE_SIZE),
  }
}

export async function getPublicArticleMetadata(id: number): Promise<PublicArticleMetadata> {
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError('Article not found', 404, 404)

  const article = await prisma.article.findFirst({
    where: publicArticleWhere(id),
    select: {
      id: true,
      title: true,
      summary: true,
      cover: true,
      publishedAt: true,
      updatedAt: true,
      requiredMembershipLevel: { select: { id: true, name: true, rank: true } },
    },
  })
  if (!article) throw new HttpError('Article not found', 404, 404)

  return {
    id: article.id.toString(),
    title: article.title,
    summary: article.summary?.trim() || '',
    cover: article.cover,
    publishedAt: article.publishedAt!,
    updatedAt: article.updatedAt,
    requiredMembershipLevel: requiredLevelDto(article.requiredMembershipLevel),
  }
}

export async function resolvePublicArticleReader(
  article: PublicArticleMetadata,
  viewer: { userId?: number; role?: string } | null,
): Promise<PublicArticleReader> {
  const requiredLevel = article.requiredMembershipLevel
  const viewerAuthenticated = Boolean(viewer?.userId)
  const membership = viewer?.userId ? await getEffectiveMembership(viewer.userId) : null
  const allowed = !requiredLevel ||
    Boolean(viewer?.role && isAdminRole(viewer.role)) ||
    Boolean(membership && membership.rank >= requiredLevel.rank)

  if (!allowed) return { ...article, content: null, locked: true, viewerAuthenticated }

  const content = await prisma.article.findFirst({
    where: publicArticleWhere(Number(article.id)),
    select: { content: true },
  })
  if (!content) throw new HttpError('Article not found', 404, 404)
  return { ...article, content: content.content, locked: false, viewerAuthenticated }
}
