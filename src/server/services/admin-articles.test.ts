import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  prisma: {
    article: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/public-article-cache', () => ({
  invalidatePublicArticleCache: mocks.invalidate,
}))
vi.mock('@/server/services/admin-catalog', () => ({
  databaseTextContains: (value: string) => ({ contains: value }),
  hasPrismaCode: (error: unknown, code: string) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === code,
}))

import {
  createAdminArticle,
  deleteAdminArticle,
  publishAdminArticle,
  updateAdminArticle,
  withdrawAdminArticle,
} from '@/server/services/admin-articles'

const firstPublishedAt = new Date('2026-08-20T02:00:00.000Z')
const createdAt = new Date('2026-08-20T01:00:00.000Z')
const requiredMembershipLevelInclude = {
  requiredMembershipLevel: { select: { id: true, name: true, rank: true } },
}

function articleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    title: 'Independent article',
    summary: null,
    cover: null,
    content: '# Body',
    status: 0,
    publishedAt: null,
    createdAt,
    updatedAt: createdAt,
    isDeleted: false,
    ...overrides,
  }
}

describe('administrator independent articles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a draft without accepting lifecycle state from the caller', async () => {
    mocks.prisma.article.create.mockResolvedValue(articleRecord())
    await createAdminArticle({
      title: ' Independent article ',
      content: '# Body',
      cover: '/uploads/article-cover/550e8400-e29b-41d4-a716-446655440000.webp',
    })

    expect(mocks.prisma.article.create).toHaveBeenCalledWith({
      data: {
        title: 'Independent article',
        summary: null,
        cover: '/uploads/article-cover/550e8400-e29b-41d4-a716-446655440000.webp',
        content: '# Body',
        status: 0,
        requiredMembershipLevelId: null,
      },
      include: requiredMembershipLevelInclude,
    })
    expect(mocks.invalidate).toHaveBeenCalledWith(8)
  })

  it('publishes complete content and preserves the first publication timestamp on republish', async () => {
    mocks.prisma.article.findFirst.mockResolvedValue(articleRecord({ publishedAt: firstPublishedAt }))
    mocks.prisma.article.update.mockResolvedValue(articleRecord({ status: 1, publishedAt: firstPublishedAt }))

    await publishAdminArticle(8)
    expect(mocks.prisma.article.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { status: 1, publishedAt: firstPublishedAt, updatedAt: expect.any(Date) },
      include: requiredMembershipLevelInclude,
    })
  })

  it('rejects publication until the body contains meaningful content', async () => {
    mocks.prisma.article.findFirst.mockResolvedValue(articleRecord({ content: '  ' }))
    await expect(publishAdminArticle(8)).rejects.toThrow('Title and content are required')
    expect(mocks.prisma.article.update).not.toHaveBeenCalled()
  })

  it('updates published content in place and invalidates the public cache', async () => {
    mocks.prisma.article.update.mockResolvedValue(articleRecord({ status: 1, content: '# Revised' }))
    await updateAdminArticle(8, { content: '# Revised' })

    expect(mocks.prisma.article.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { content: '# Revised', updatedAt: expect.any(Date) },
      include: requiredMembershipLevelInclude,
    })
    expect(mocks.invalidate).toHaveBeenCalledWith(8)
  })

  it('withdraws without clearing first publication time and soft-deletes to a draft state', async () => {
    mocks.prisma.article.findFirst.mockResolvedValue(articleRecord({ status: 1, publishedAt: firstPublishedAt }))
    mocks.prisma.article.update
      .mockResolvedValueOnce(articleRecord({ publishedAt: firstPublishedAt }))
      .mockResolvedValueOnce(articleRecord({ isDeleted: true }))

    await withdrawAdminArticle(8)
    expect(mocks.prisma.article.update).toHaveBeenNthCalledWith(1, {
      where: { id: 8 },
      data: { status: 0, updatedAt: expect.any(Date) },
      include: requiredMembershipLevelInclude,
    })

    await deleteAdminArticle(8)
    expect(mocks.prisma.article.update).toHaveBeenNthCalledWith(2, {
      where: { id: 8 },
      data: { isDeleted: true, status: 0, updatedAt: expect.any(Date) },
      include: requiredMembershipLevelInclude,
    })
  })
})
