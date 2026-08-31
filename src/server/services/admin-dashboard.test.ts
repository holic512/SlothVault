import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    session: { count: vi.fn(), findMany: vi.fn() },
    giftCard: { count: vi.fn() },
    article: { count: vi.fn(), findMany: vi.fn() },
    project: { count: vi.fn(), findMany: vi.fn() },
    projectVersion: { count: vi.fn() },
    category: { count: vi.fn() },
    noteInfo: { count: vi.fn(), findMany: vi.fn() },
    fileManagement: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    releaseCredential: { count: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import { getAdminDashboard, isAdminDashboardRange, maskDashboardIp } from '@/server/services/admin-dashboard'

const now = new Date('2026-08-10T12:30:00.000Z')

describe('admin dashboard service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const model of [
      mocks.prisma.user,
      mocks.prisma.session,
      mocks.prisma.giftCard,
      mocks.prisma.article,
      mocks.prisma.project,
      mocks.prisma.projectVersion,
      mocks.prisma.category,
      mocks.prisma.noteInfo,
      mocks.prisma.fileManagement,
      mocks.prisma.releaseCredential,
    ]) {
      Object.values(model).forEach((method) => method.mockResolvedValue(0))
    }
    mocks.prisma.user.aggregate.mockResolvedValue({ _sum: { pointsBalance: 420 } })
    mocks.prisma.fileManagement.aggregate.mockResolvedValue({ _sum: { fileSize: 3072n } })
    mocks.prisma.fileManagement.groupBy.mockResolvedValue([
      { businessType: 'NoteAttachment', _count: { id: 2 }, _sum: { fileSize: 3072n } },
    ])
    mocks.prisma.user.findMany.mockResolvedValue([{ createdAt: new Date('2026-08-09T08:00:00.000Z') }])
    mocks.prisma.project.findMany.mockImplementation((input) => input.take
      ? [{ id: 4, projectName: 'Atlas', status: 1, createdAt: new Date('2026-08-10T09:00:00.000Z'), _count: { versions: 2 } }]
      : [{ createdAt: new Date('2026-08-08T11:00:00.000Z') }])
    mocks.prisma.article.findMany.mockImplementation((input) => input.take
      ? [{ id: 3, title: 'Release notes', status: 1, publishedAt: new Date('2026-08-09T07:00:00.000Z'), updatedAt: new Date('2026-08-10T08:00:00.000Z') }]
      : [{ publishedAt: new Date('2026-08-07T12:00:00.000Z') }])
    mocks.prisma.noteInfo.findMany.mockImplementation((input) => input.take
      ? [{ id: 9, noteTitle: 'Install', status: 1, createdAt: new Date('2026-08-10T07:00:00.000Z'), category: { categoryName: 'Guides', projectVersion: { version: '1.0.0', project: { id: 4, projectName: 'Atlas' } } } }]
      : [{ createdAt: new Date('2026-08-10T06:00:00.000Z') }])
    mocks.prisma.session.findMany.mockResolvedValue([
      { id: 'session-1', createdAt: new Date('2026-08-10T10:00:00.000Z'), expiresAt: new Date('2026-08-11T10:00:00.000Z'), revokedAt: null, ip: '203.0.113.24', User: { username: 'writer' } },
    ])
  })

  it('creates a portable UTC seven-day trend with zero-filled dates and recent activity', async () => {
    const result = await getAdminDashboard({ range: 7, now })

    expect(result.range).toMatchObject({ days: 7, start: '2026-08-04', end: '2026-08-10' })
    expect(result.trend).toHaveLength(7)
    expect(result.trend[0]).toMatchObject({ date: '2026-08-04', users: 0, projects: 0, articles: 0, notes: 0 })
    expect(result.trend[3]).toMatchObject({ date: '2026-08-07', articles: 1 })
    expect(result.trend[4]).toMatchObject({ date: '2026-08-08', projects: 1 })
    expect(result.trend[5]).toMatchObject({ date: '2026-08-09', users: 1 })
    expect(result.trend[6]).toMatchObject({ date: '2026-08-10', notes: 1 })
    expect(result.periodTotals).toEqual({ users: 1, projects: 1, articles: 1, notes: 1 })
    expect(result.overview.files).toMatchObject({ totalSizeBytes: 3072n, totalSizeMB: '0.00' })
    expect(result.recentActivity.sessions[0]).toMatchObject({ username: 'writer', maskedIp: '203.0.•••.•••', isActive: true })
    expect(result.recentActivity.feed).toHaveLength(4)
    expect(result.recentActivity.feed[0]).toMatchObject({ type: 'session', title: 'writer' })
  })

  it('accepts only supported trend ranges and masks IPv4 and IPv6 addresses', () => {
    expect(isAdminDashboardRange(7)).toBe(true)
    expect(isAdminDashboardRange(30)).toBe(true)
    expect(isAdminDashboardRange(90)).toBe(true)
    expect(isAdminDashboardRange(31)).toBe(false)
    expect(maskDashboardIp('203.0.113.24')).toBe('203.0.•••.•••')
    expect(maskDashboardIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8::••••')
    expect(maskDashboardIp(null)).toBe('-')
  })

  it.each([[30, '2026-07-12'], [90, '2026-05-13']] as const)('fills the full %d-day trend window', async (range, start) => {
    const result = await getAdminDashboard({ range, now })

    expect(result.range.days).toBe(range)
    expect(result.trend).toHaveLength(range)
    expect(result.trend[0].date).toBe(start)
    expect(result.trend.at(-1)?.date).toBe('2026-08-10')
  })

  it('returns safe zero values for an empty database and calculates evidence states', async () => {
    mocks.prisma.user.aggregate.mockResolvedValue({ _sum: { pointsBalance: null } })
    mocks.prisma.fileManagement.aggregate.mockResolvedValue({ _sum: { fileSize: null } })
    mocks.prisma.fileManagement.groupBy.mockResolvedValue([])
    mocks.prisma.user.findMany.mockResolvedValue([])
    mocks.prisma.project.findMany.mockResolvedValue([])
    mocks.prisma.article.findMany.mockResolvedValue([])
    mocks.prisma.noteInfo.findMany.mockResolvedValue([])
    mocks.prisma.session.findMany.mockResolvedValue([])
    mocks.prisma.releaseCredential.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)

    const result = await getAdminDashboard({ range: 7, now })

    expect(result.overview.users.totalPoints).toBe(0)
    expect(result.overview.files).toMatchObject({ total: 0, totalSizeBytes: 0n, byType: [] })
    expect(result.overview.blockchain.evidence).toEqual({ total: 5, finalized: 2, failed: 1, pending: 2 })
    expect(result.health).toEqual({
      projectUtilization: 0,
      articlePublicationRate: 0,
      noteUtilization: 0,
      categoryUtilization: 0,
      evidenceFinalizationRate: 40,
    })
    expect(result.trend.every((point) => point.users + point.projects + point.articles + point.notes === 0)).toBe(true)
    expect(result.recentActivity.feed).toEqual([])
    expect(mocks.prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isDeleted: false }),
    }))
    expect(mocks.prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isDeleted: false, publishedAt: expect.any(Object) }),
    }))
  })
})
