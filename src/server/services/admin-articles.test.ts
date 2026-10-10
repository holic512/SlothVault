import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  transaction: vi.fn(),
  prisma: {
    article: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/server/database/unit-of-work', () => ({ unitOfWork: { execute: (operation: (tx: typeof mocks.prisma) => unknown) => operation(mocks.prisma) } }))
vi.mock('@/server/prisma', () => ({ prisma: { ...mocks.prisma, $transaction: mocks.transaction } }))
vi.mock('@/server/services/file-references', () => ({ assertManagedContentFiles: vi.fn(), indexFileWrite: (_tx: unknown, _type: unknown, write: Promise<unknown>) => write }))
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
  getAdminArticle,
  listAdminArticles,
  publishAdminArticle,
  updateAdminArticle,
  withdrawAdminArticle,
} from '@/server/services/admin-articles'

const firstPublishedAt = new Date('2026-08-20T02:00:00.000Z')
const createdAt = new Date('2026-08-20T01:00:00.000Z')
const requiredMembershipLevelInclude = {
  requiredMembershipLevel: { select: { id: true, name: true, rank: true } },
  allowedMemberships: { include: { membershipLevel: { select: { id: true, name: true, rank: true, status: true } } } },
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
  beforeEach(() => { vi.clearAllMocks(); mocks.transaction.mockImplementation((operation) => operation(mocks.prisma)); mocks.prisma.article.updateMany.mockResolvedValue({ count: 1 }) })

  it('selects only metadata while preserving filters, ordering, pagination and membership DTOs', async () => {
    mocks.prisma.article.count.mockResolvedValue(31)
    // Intentionally include a body in this mock: the DTO must not leak it even if a reader regresses.
    mocks.prisma.article.findMany.mockResolvedValue([articleRecord({
      requiredMembershipLevelId: 2,
      requiredMembershipLevel: { id: 2, name: 'Member', rank: 1 },
      allowedMemberships: [{ membershipLevelId: 2, membershipLevel: { id: 2, name: 'Member', rank: 1, status: 1 } }],
    })])
    const result = await listAdminArticles({ page: 2, pageSize: 10, skip: 10, keyword: 'guide', status: 0 })
    const query = mocks.prisma.article.findMany.mock.calls[0][0]
    expect(query).toMatchObject({
      where: { isDeleted: false, status: 0, OR: [{ title: { contains: 'guide' } }, { summary: { contains: 'guide' } }] },
      skip: 10, take: 10, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, summary: true, ...requiredMembershipLevelInclude },
    })
    expect(query).not.toHaveProperty('include')
    expect(query.select).not.toHaveProperty('content')
    expect(mocks.prisma.article.count).toHaveBeenCalledWith({ where: query.where })
    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 31, list: [{
      id: '8', summary: null, requiredMembershipLevelId: '2',
      allowedMembershipLevelIds: ['2'], allowedMembershipLevels: [{ id: '2', name: 'Member', rank: 1, status: 1 }],
    }] })
    expect(result.list[0]).not.toHaveProperty('content')
    expect(result.list[0]).not.toHaveProperty('allowedMemberships')
  })

  it('keeps complete bodies in article details', async () => {
    mocks.prisma.article.findUnique.mockResolvedValue(articleRecord())
    expect(await getAdminArticle(8)).toMatchObject({ id: '8', content: '# Body' })
  })

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
        allowedMemberships: { create: [] },
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
    mocks.prisma.article.update.mockResolvedValueOnce(articleRecord({ publishedAt: firstPublishedAt }))
    mocks.prisma.article.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.article.findUnique.mockResolvedValue(articleRecord({ isDeleted: true }))

    await withdrawAdminArticle(8)
    expect(mocks.prisma.article.update).toHaveBeenNthCalledWith(1, {
      where: { id: 8 },
      data: { status: 0, updatedAt: expect.any(Date) },
      include: requiredMembershipLevelInclude,
    })

    await deleteAdminArticle(8)
    expect(mocks.prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 8, isDeleted: false },
      data: { isDeleted: true, deletedAt: expect.any(Date), status: 0, updatedAt: expect.any(Date) },
    })
  })
})
