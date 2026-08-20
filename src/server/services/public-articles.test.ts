import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    article: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  articleSummary,
  getPublicArticle,
  listPublicArticles,
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
    }])

    await expect(listPublicArticles(2)).resolves.toEqual({
      list: [{
        id: '8',
        title: 'Independent',
        summary: 'Body',
        cover: null,
        publishedAt,
        updatedAt,
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
    await expect(getPublicArticle(9)).rejects.toMatchObject({ status: 404 })
    expect(mocks.prisma.article.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 1, isDeleted: false, publishedAt: { not: null } },
    }))
  })
})
