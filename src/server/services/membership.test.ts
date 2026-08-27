import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  execute: vi.fn(),
  prisma: {
    membershipGrant: { findMany: vi.fn() },
    membershipLevel: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  transaction: {
    membershipGrant: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    membershipLevel: { findUnique: vi.fn() },
    pointTransaction: { create: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/server/database/unit-of-work', () => ({ unitOfWork: { execute: mocks.execute } }))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: mocks.invalidate }))

import {
  MEMBERSHIP_GRANT_SOURCE,
  membershipSummaryFromGrants,
  purchaseMembership,
  replaceManagedUserMembership,
} from '@/server/services/membership'

const now = new Date('2026-08-27T00:00:00.000Z')
const later = new Date('2026-09-10T00:00:00.000Z')

function level(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    name: 'VIP',
    rank: 2,
    pricePoints: 30,
    validityDays: 30,
    status: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    userId: 8,
    membershipLevelId: 2,
    source: MEMBERSHIP_GRANT_SOURCE.POINT_PURCHASE,
    pointsCost: 30,
    grantedByUserId: null,
    grantedAt: now,
    expiresAt: later,
    revokedAt: null,
    revokedByUserId: null,
    membershipLevel: level(),
    ...overrides,
  }
}

describe('membership entitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockImplementation((operation) => operation(mocks.transaction))
  })

  it('selects the highest active grant and falls back after a higher grant expires', () => {
    const permanentBasic = grant({
      id: 1,
      membershipLevelId: 1,
      expiresAt: null,
      membershipLevel: level({ id: 1, name: 'Basic', rank: 1 }),
    })
    const temporaryVip = grant()
    const expiredElite = grant({
      id: 3,
      expiresAt: new Date('2026-08-26T00:00:00.000Z'),
      membershipLevel: level({ id: 3, name: 'Elite', rank: 3 }),
    })

    expect(membershipSummaryFromGrants([permanentBasic, temporaryVip, expiredElite], now)).toMatchObject({
      id: '2', name: 'VIP', rank: 2, expiresAt: later,
    })
    expect(membershipSummaryFromGrants([permanentBasic, temporaryVip], new Date('2026-09-11T00:00:00.000Z')))
      .toMatchObject({ id: '1', name: 'Basic', rank: 1, expiresAt: null })
  })

  it('purchases a higher level atomically and extends from the current finite expiry', async () => {
    const basicGrant = grant({
      id: 1,
      membershipLevelId: 1,
      expiresAt: later,
      membershipLevel: level({ id: 1, name: 'Basic', rank: 1, pricePoints: 10, validityDays: 7 }),
    })
    const target = level()
    const created = grant({ id: 9, expiresAt: new Date('2026-10-10T00:00:00.000Z') })
    mocks.transaction.user.findUnique.mockResolvedValue({ id: 8, pointsBalance: 80 })
    mocks.transaction.membershipLevel.findUnique.mockResolvedValue(target)
    mocks.transaction.membershipGrant.findMany.mockResolvedValue([basicGrant])
    mocks.transaction.membershipGrant.create.mockResolvedValue(created)
    mocks.transaction.user.update.mockResolvedValue({ pointsBalance: 50 })

    await expect(purchaseMembership({ userId: 8, membershipLevelId: 2 })).resolves.toMatchObject({
      pointsBalance: 50,
      membership: { id: '2', rank: 2 },
    })
    expect(mocks.transaction.membershipGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 8,
        membershipLevelId: 2,
        source: 'POINT_PURCHASE',
        pointsCost: 30,
        expiresAt: expect.any(Date),
      }),
    }))
    expect(mocks.transaction.pointTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 8,
        amount: -30,
        balanceAfter: 50,
        type: 'MEMBERSHIP_PURCHASE',
        referenceId: '9',
      }),
    })
  })

  it('rejects a lower-level purchase while a higher entitlement is active', async () => {
    mocks.transaction.user.findUnique.mockResolvedValue({ id: 8, pointsBalance: 80 })
    mocks.transaction.membershipLevel.findUnique.mockResolvedValue(level({ id: 1, rank: 1 }))
    mocks.transaction.membershipGrant.findMany.mockResolvedValue([grant()])

    await expect(purchaseMembership({ userId: 8, membershipLevelId: 1 })).rejects.toThrow(/lower membership level/)
    expect(mocks.transaction.membershipGrant.create).not.toHaveBeenCalled()
  })

  it('replaces active grants before an administrator-issued entitlement', async () => {
    mocks.transaction.user.findUnique.mockResolvedValue({ id: 8 })
    mocks.transaction.membershipLevel.findUnique.mockResolvedValue(level())
    mocks.transaction.membershipGrant.updateMany.mockResolvedValue({ count: 2 })
    mocks.transaction.membershipGrant.create.mockResolvedValue(grant({ source: 'ADMIN_GRANT' }))
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 8 })
    mocks.prisma.membershipGrant.findMany.mockResolvedValue([])

    await replaceManagedUserMembership({
      actorUserId: 1,
      userId: 8,
      membershipLevelId: 2,
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    expect(mocks.transaction.membershipGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 8, revokedAt: null },
      data: expect.objectContaining({ revokedByUserId: 1 }),
    }))
    expect(mocks.transaction.membershipGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'ADMIN_GRANT', grantedByUserId: 1 }),
    }))
  })
})
