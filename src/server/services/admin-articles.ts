/**
 * @file admin-articles.ts
 * @project SlothVault
 * @module Administrator Article Publishing
 * @description Owns administrator-only CRUD and lifecycle operations for independent blog articles.
 * @logic Query metadata-only lists and full details separately; require uploaded material for changed content and persist membership allowlists and references atomically, validate publication under a row lock, preserve the first publication timestamp, and invalidate public cache after mutations.
 * @dependencies Prisma Article model, document content limits, HTTP errors, public article cache
 * @index_tags admin,article,blog,crud,publish,withdraw
 * @author holic512
 */
import 'server-only'
import { assertManagedContentFiles, indexFileWrite } from './file-references'
import { allowedMembershipIdsSchema, validateMembershipIds } from './content-access'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { DOCUMENT_CONTENT_MAX_CHARACTERS } from '@/lib/document-content'
import { HttpError } from '@/server/http/errors'
import { unitOfWork } from '@/server/database/unit-of-work'
import { prisma } from '@/server/prisma'
import { deleteTrashItem } from '@/server/services/admin-trash'
import { databaseTextContains, hasPrismaCode } from '@/server/services/admin-catalog'
import { invalidatePublicArticleCache } from '@/server/services/public-article-cache'

const ARTICLE_ACCESS_INCLUDE = {
  requiredMembershipLevel: { select: { id: true, name: true, rank: true } },
  allowedMemberships: { include: { membershipLevel: { select: { id: true, name: true, rank: true, status: true } } } },
} as const

async function articleMembershipIds(input: { allowedMembershipLevelIds?: unknown; requiredMembershipLevelId?: unknown }) {
  if (input.allowedMembershipLevelIds !== undefined && input.requiredMembershipLevelId !== undefined) {
    throw new HttpError('Do not combine legacy and multiple membership fields', 400, 400)
  }
  if (input.allowedMembershipLevelIds !== undefined) return validateMembershipIds(allowedMembershipIdsSchema.parse(input.allowedMembershipLevelIds))
  if (input.requiredMembershipLevelId !== undefined) {
    const id = requiredMembershipLevelValue(input.requiredMembershipLevelId)
    await assertMembershipLevelExists(id)
    return id ? [id] : []
  }
  return undefined
}

const ARTICLE_TITLE_MAX_CHARACTERS = 255
const ARTICLE_SUMMARY_MAX_CHARACTERS = 500
const ARTICLE_COVER_MAX_CHARACTERS = 500
const ARTICLE_COVER_PATTERN = /^\/uploads\/article-cover\/[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i

type ArticleMetadataLike = {
  id: number
  title: string
  summary: string | null
  cover: string | null
  status: number
  requiredMembershipLevelId: number | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  deletedAt?: Date | null
  allowedMemberships?: Array<{ membershipLevelId: number; membershipLevel: { id: number; name: string; rank: number; status: number } }>
  requiredMembershipLevel?: { id: number; name: string; rank: number } | null
}

export function adminArticleListDto(article: ArticleMetadataLike) {
  return {
    id: article.id.toString(),
    title: article.title,
    summary: article.summary,
    cover: article.cover,
    status: article.status,
    publishedAt: article.publishedAt,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    isDeleted: article.isDeleted,
    deletedAt: article.deletedAt,
    allowedMembershipLevelIds: (article.allowedMemberships ?? []).map((item) => String(item.membershipLevelId)),
    allowedMembershipLevels: (article.allowedMemberships ?? []).map(({ membershipLevel }) => ({ ...membershipLevel, id: String(membershipLevel.id) })),
    requiredMembershipLevelId: article.requiredMembershipLevelId?.toString() ?? null,
    requiredMembershipLevel: article.requiredMembershipLevel
      ? { ...article.requiredMembershipLevel, id: article.requiredMembershipLevel.id.toString() }
      : null,
  }
}

export function adminArticleDto(article: ArticleMetadataLike & { content: string }) {
  return { ...adminArticleListDto(article), content: article.content }
}

export type AdminArticleListDto = ReturnType<typeof adminArticleListDto>
export type AdminArticleDto = ReturnType<typeof adminArticleDto>

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

async function assertMembershipLevelExists(id: number | null | undefined, reader: Pick<Prisma.TransactionClient, 'membershipLevel'> = prisma) {
  if (id === undefined || id === null) return
  const level = await reader.membershipLevel.findUnique({
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
}) {
  const where: Prisma.ArticleWhereInput = { isDeleted: false }
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
      select: {
        id: true,
        title: true,
        summary: true,
        cover: true,
        status: true,
        requiredMembershipLevelId: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        isDeleted: true,
        deletedAt: true,
        ...ARTICLE_ACCESS_INCLUDE,
      },
    }),
  ])

  return {
    list: list.map(adminArticleListDto),
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
  allowedMembershipLevelIds?: unknown
}) {
  const membershipIds = await articleMembershipIds(input)
  const article = await prisma.$transaction(async (fileTx) => {
    await assertManagedContentFiles(fileTx, contentValue(input.content ?? '')!, [coverValue(input.cover)])
    return indexFileWrite(fileTx, 'ARTICLE', fileTx.article.create({
      data: {
        title: titleValue(input.title)!,
        summary: summaryValue(input.summary) ?? null,
        cover: coverValue(input.cover) ?? null,
        content: contentValue(input.content ?? '')!,
        status: 0,
        requiredMembershipLevelId: null,
        allowedMemberships: { create: (membershipIds ?? []).map((membershipLevelId) => ({ membershipLevelId })) },
      },
      include: ARTICLE_ACCESS_INCLUDE,
    }))
  })
  await invalidatePublicArticleCache(article.id)
  return adminArticleDto(article)
}

export async function getAdminArticle(id: number) {
  const article = await prisma.article.findUnique({
    where: { id },
    include: ARTICLE_ACCESS_INCLUDE,
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
  allowedMembershipLevelIds?: unknown
  isDeleted?: unknown
}) {
  const data: Prisma.ArticleUncheckedUpdateInput = { updatedAt: new Date() }
  const title = titleValue(input.title, false)
  const summary = summaryValue(input.summary)
  const cover = coverValue(input.cover)
  const content = contentValue(input.content, false)
  const membershipIds = await articleMembershipIds(input)
  if (title !== undefined) data.title = title
  if (summary !== undefined) data.summary = summary
  if (cover !== undefined) data.cover = cover
  if (content !== undefined) data.content = content
  if (membershipIds !== undefined) {
    data.requiredMembershipLevelId = null
    data.allowedMemberships = { deleteMany: {}, create: membershipIds.map((membershipLevelId) => ({ membershipLevelId })) }
  }
  if (input.isDeleted !== undefined) throw new HttpError('Restore from the trash', 409, 409)
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const article = await prisma.$transaction(async (fileTx) => {
      if (content !== undefined || cover !== undefined) {
        const current = await fileTx.article.findUnique({ where: { id }, select: { content: true, cover: true } })
        if (!current) throw new HttpError('Article not found', 404, 404)
        await assertManagedContentFiles(fileTx, content !== current.content ? content : undefined, cover !== current.cover ? [cover] : [])
      }
      return indexFileWrite(fileTx, 'ARTICLE', fileTx.article.update({
        where: { id },
        data,
        include: ARTICLE_ACCESS_INCLUDE,
      }))
    })
    await invalidatePublicArticleCache(id)
    return adminArticleDto(article)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Article not found', 404, 404)
    throw error
  }
}

export async function deleteAdminArticle(id: number) {
  await deleteTrashItem('article', id)
  return getAdminArticle(id)
}

export async function publishAdminArticle(id: number) {
  const article = await unitOfWork.execute(async (tx) => {
    const locked = await tx.article.updateMany({
      where: { id, isDeleted: false }, data: { updatedAt: new Date() },
    })
    if (locked.count !== 1) throw new HttpError('Article not found', 404, 404)
    const current = await tx.article.findFirst({ where: { id, isDeleted: false } })
    if (!current) throw new HttpError('Article not found', 404, 404)
    if (!current.title.trim() || !current.content.trim()) {
      throw new HttpError('Title and content are required before publishing', 400, 400)
    }
    return indexFileWrite(tx, 'ARTICLE', tx.article.update({
      where: { id },
      data: { status: 1, publishedAt: current.publishedAt ?? new Date(), updatedAt: new Date() },
      include: ARTICLE_ACCESS_INCLUDE,
    }))
  }, { mode: 'write', isolationLevel: 'Serializable' })
  await invalidatePublicArticleCache(id)
  return adminArticleDto(article)
}

export async function withdrawAdminArticle(id: number) {
  const current = await prisma.article.findFirst({ where: { id, isDeleted: false } })
  if (!current) throw new HttpError('Article not found', 404, 404)

  const article = await prisma.$transaction((fileTx) => indexFileWrite(fileTx, 'ARTICLE', fileTx.article.update({
    where: { id },
    data: { status: 0, updatedAt: new Date() },
    include: ARTICLE_ACCESS_INCLUDE,
  })))
  await invalidatePublicArticleCache(id)
  return adminArticleDto(article)
}
