import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    article: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  getEffectiveMembership: vi.fn(),
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/membership', () => ({
  getEffectiveMembership: mocks.getEffectiveMembership,
}))

import {
  articleSummary,
  getPublicArticleMetadata,
  listPublicArticles,
  resolvePublicArticleReader,
} from '@/server/services/public-articles'

const publishedAt = new Date('2026-08-20T02:00:00.000Z')
const updatedAt = new Date('2026-08-20T03:00:00.000Z')

describe('public independent articles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('derives a bounded plain-text summary from Markdown and safe HTML', () => {
    expect(articleSummary('# Hello\n\nA **careful** [link](https://example.com).')).toBe('Hello A careful link.')
    expect(articleSummary('a'.repeat(170))).toHaveLength(160)
  })

  it('lists only published visible articles in stable publication order', async () => {
    mocks.prisma.article.count.mockResolvedValue(1)
    mocks.prisma.article.findMany.mockResolvedValue([{
      id: 8,
      title: 'Independent',
      summary: null,
      cover: null,
      content: '# Body',
      publishedAt,
      updatedAt,
      requiredMembershipLevel: null,
    }])

    await expect(listPublicArticles(2)).resolves.toEqual({
      list: [{
        id: '8',
        title: 'Independent',
        summary: 'Body',
        cover: null,
        publishedAt,
        updatedAt,
        requiredMembershipLevel: null,
      }],
      page: 2,
      pageSize: 12,
      total: 1,
      totalPages: 1,
    })
    expect(mocks.prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 1, isDeleted: false, publishedAt: { not: null } },
      skip: 12,
      take: 12,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    }))
  })

  it('returns 404 for a draft, withdrawn, deleted, or missing article', async () => {
    mocks.prisma.article.findFirst.mockResolvedValue(null)
    await expect(getPublicArticleMetadata(9)).rejects.toMatchObject({ status: 404 })
    expect(mocks.prisma.article.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 1, isDeleted: false, publishedAt: { not: null } },
    }))
  })

  it('keeps protected bodies out of an anonymous reader response', async () => {
    const article = {
      id: '8',
      title: 'Members only',
      summary: 'Summary',
      cover: null,
      publishedAt,
      updatedAt,
      requiredMembershipLevel: { id: '2', name: 'VIP', rank: 2 },
    }

    await expect(resolvePublicArticleReader(article, null)).resolves.toEqual({
      ...article,
      content: null,
      locked: true,
      viewerAuthenticated: false,
    })
    expect(mocks.prisma.article.findFirst).not.toHaveBeenCalled()
  })

  it('loads a protected body only after an eligible member passes the server check', async () => {
    mocks.getEffectiveMembership.mockResolvedValue({ id: '2', name: 'VIP', rank: 2, expiresAt: null, source: 'POINT_PURCHASE' })
    mocks.prisma.article.findFirst.mockResolvedValue({ content: '# Private body' })
    const article = {
      id: '8',
      title: 'Members only',
      summary: 'Summary',
      cover: null,
      publishedAt,
      updatedAt,
      requiredMembershipLevel: { id: '2', name: 'VIP', rank: 2 },
    }

    await expect(resolvePublicArticleReader(article, { userId: 7, role: 'USER' })).resolves.toMatchObject({
      content: '# Private body',
      locked: false,
      viewerAuthenticated: true,
    })
    expect(mocks.getEffectiveMembership).toHaveBeenCalledWith(7)
    expect(mocks.prisma.article.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: { content: true },
    }))
  })
})
