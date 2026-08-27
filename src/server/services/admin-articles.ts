/**
 * @file admin-articles.ts
 * @project SlothVault
 * @module Administrator Article Publishing
 * @description Owns administrator-only CRUD and lifecycle operations for independent blog articles.
 * @logic Validate the standalone article contract, preserve the first publication timestamp across withdrawals, soft-delete to a draft state, and invalidate public cache after every mutation.
 * @dependencies Prisma Article model, document content limits, HTTP errors, public article cache
 * @index_tags admin,article,blog,crud,publish,withdraw
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { DOCUMENT_CONTENT_MAX_CHARACTERS } from '@/lib/document-content'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { databaseTextContains, hasPrismaCode } from '@/server/services/admin-catalog'
import { invalidatePublicArticleCache } from '@/server/services/public-article-cache'

const ARTICLE_TITLE_MAX_CHARACTERS = 255
const ARTICLE_SUMMARY_MAX_CHARACTERS = 500
const ARTICLE_COVER_MAX_CHARACTERS = 500
const ARTICLE_COVER_PATTERN = /^\/uploads\/article-cover\/[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i

type ArticleLike = {
  id: number
  title: string
  summary: string | null
  cover: string | null
  content: string
  status: number
  requiredMembershipLevelId: number | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  requiredMembershipLevel?: { id: number; name: string; rank: number } | null
}

export function adminArticleDto(article: ArticleLike) {
  return {
    ...article,
    id: article.id.toString(),
    requiredMembershipLevelId: article.requiredMembershipLevelId?.toString() ?? null,
    requiredMembershipLevel: article.requiredMembershipLevel
      ? { ...article.requiredMembershipLevel, id: article.requiredMembershipLevel.id.toString() }
      : null,
  }
}

function titleValue(value: unknown, required = true) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') throw new HttpError('Invalid title', 400, 400)
  const title = value.trim()
  if (!title || title.length > ARTICLE_TITLE_MAX_CHARACTERS) {
    throw new HttpError('Invalid title', 400, 400)
  }
  return title
}

function summaryValue(value: unknown) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new HttpError('Invalid summary', 400, 400)
  const summary = value.trim()
  if (summary.length > ARTICLE_SUMMARY_MAX_CHARACTERS) {
    throw new HttpError('Invalid summary', 400, 400)
  }
  return summary || null
}

function coverValue(value: unknown) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (
    typeof value !== 'string' ||
    value.length > ARTICLE_COVER_MAX_CHARACTERS ||
    !ARTICLE_COVER_PATTERN.test(value)
  ) {
    throw new HttpError('Invalid article cover', 400, 400)
  }
  return value
}

function contentValue(value: unknown, required = true) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length > DOCUMENT_CONTENT_MAX_CHARACTERS) {
    throw new HttpError('Invalid content', 400, 400)
  }
  return value
}

function requiredMembershipLevelValue(value: unknown) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpError('Invalid required membership level', 400, 400)
  }
  return value
}

async function assertMembershipLevelExists(id: number | null | undefined) {
  if (id === undefined || id === null) return
  const level = await prisma.membershipLevel.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!level) throw new HttpError('Membership level not found', 400, 400)
}

export async function listAdminArticles(input: {
  page: number
  pageSize: number
  skip: number
  keyword: string
  status?: number
  includeDeleted: boolean
}) {
  const where: Prisma.ArticleWhereInput = {}
  if (!input.includeDeleted) where.isDeleted = false
  if (input.status === 0 || input.status === 1) where.status = input.status
  if (input.keyword) {
    where.OR = [
      { title: databaseTextContains(input.keyword) },
      { summary: databaseTextContains(input.keyword) },
    ]
  }

  const [total, list] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      skip: input.skip,
      take: input.pageSize,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
    }),
  ])

  return {
    list: list.map(adminArticleDto),
    page: input.page,
    pageSize: input.pageSize,
    total,
  }
}

export async function createAdminArticle(input: {
  title?: unknown
  summary?: unknown
  cover?: unknown
  content?: unknown
  requiredMembershipLevelId?: unknown
}) {
  const requiredMembershipLevelId = requiredMembershipLevelValue(input.requiredMembershipLevelId)
  await assertMembershipLevelExists(requiredMembershipLevelId)
  const article = await prisma.article.create({
    data: {
      title: titleValue(input.title)!,
      summary: summaryValue(input.summary) ?? null,
      cover: coverValue(input.cover) ?? null,
      content: contentValue(input.content ?? '')!,
      status: 0,
      requiredMembershipLevelId: requiredMembershipLevelId ?? null,
    },
    include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
  })
  await invalidatePublicArticleCache(article.id)
  return adminArticleDto(article)
}

export async function getAdminArticle(id: number) {
  const article = await prisma.article.findUnique({
    where: { id },
    include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
  })
  if (!article) throw new HttpError('Article not found', 404, 404)
  return adminArticleDto(article)
}

export async function updateAdminArticle(id: number, input: {
  title?: unknown
  summary?: unknown
  cover?: unknown
  content?: unknown
  requiredMembershipLevelId?: unknown
  isDeleted?: unknown
}) {
  const data: Prisma.ArticleUncheckedUpdateInput = { updatedAt: new Date() }
  const title = titleValue(input.title, false)
  const summary = summaryValue(input.summary)
  const cover = coverValue(input.cover)
  const content = contentValue(input.content, false)
  const requiredMembershipLevelId = requiredMembershipLevelValue(input.requiredMembershipLevelId)
  if (title !== undefined) data.title = title
  if (summary !== undefined) data.summary = summary
  if (cover !== undefined) data.cover = cover
  if (content !== undefined) data.content = content
  if (requiredMembershipLevelId !== undefined) {
    await assertMembershipLevelExists(requiredMembershipLevelId)
    data.requiredMembershipLevelId = requiredMembershipLevelId
  }
  if (input.isDeleted !== undefined) {
    if (input.isDeleted !== false) throw new HttpError('Invalid restore state', 400, 400)
    data.isDeleted = false
    data.status = 0
  }
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const article = await prisma.article.update({
      where: { id },
      data,
      include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
    })
    await invalidatePublicArticleCache(id)
    return adminArticleDto(article)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Article not found', 404, 404)
    throw error
  }
}

export async function deleteAdminArticle(id: number) {
  try {
    const article = await prisma.article.update({
      where: { id },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
      include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
    })
    await invalidatePublicArticleCache(id)
    return adminArticleDto(article)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Article not found', 404, 404)
    throw error
  }
}

export async function publishAdminArticle(id: number) {
  const current = await prisma.article.findFirst({ where: { id, isDeleted: false } })
  if (!current) throw new HttpError('Article not found', 404, 404)
  if (!current.title.trim() || !current.content.trim()) {
    throw new HttpError('Title and content are required before publishing', 400, 400)
  }
  await assertMembershipLevelExists(current.requiredMembershipLevelId)

  const article = await prisma.article.update({
    where: { id },
    data: {
      status: 1,
      publishedAt: current.publishedAt ?? new Date(),
      updatedAt: new Date(),
    },
    include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
  })
  await invalidatePublicArticleCache(id)
  return adminArticleDto(article)
}

export async function withdrawAdminArticle(id: number) {
  const current = await prisma.article.findFirst({ where: { id, isDeleted: false } })
  if (!current) throw new HttpError('Article not found', 404, 404)

  const article = await prisma.article.update({
    where: { id },
    data: { status: 0, updatedAt: new Date() },
    include: { requiredMembershipLevel: { select: { id: true, name: true, rank: true } } },
  })
  await invalidatePublicArticleCache(id)
  return adminArticleDto(article)
}
