/**
 * @file points.ts
 * @project SlothVault
 * @module Core Points Ledger
 * @description Owns user balances, immutable point transactions and administrator adjustments; card compatibility delegates to the plugin.
 * @logic Keep ledger ownership in the host and delegate card commands through the active-plugin boundary.
 * @dependencies Prisma User/PointTransaction models, database/unit-of-work, plugin compatibility adapter
 * @index_tags points,gift-card,redeem,ledger,admin,transaction
 * @author holic512
 */
import 'server-only'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { activeMembershipsFromGrants, membershipSummaryFromGrants } from '@/server/services/membership'

export const POINT_TRANSACTION_TYPE = {
  CARD_REDEEM: 'CARD_REDEEM',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
  MEMBERSHIP_PURCHASE: 'MEMBERSHIP_PURCHASE',
} as const

export { issueGiftCardBatch, redeemGiftCard, listGiftCardBatches } from '@/server/plugins/gift-cards'

export async function listUserPointTransactions(userId: number, page: number, pageSize: number) {
  const [list, total, user] = await Promise.all([
    prisma.pointTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pointTransaction.count({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } }),
  ])
  return {
    pointsBalance: user?.pointsBalance ?? 0,
    total,
    list: list.map((item) => ({
      id: item.id.toString(),
      amount: item.amount,
      balanceAfter: item.balanceAfter,
      type: item.type,
      description: item.description,
      createdAt: item.createdAt,
    })),
  }
}

export async function listUsers(input: {
  page: number
  pageSize: number
  keyword?: string
  role?: string
  status?: number
}) {
  const now = new Date()
  const keyword = input.keyword?.trim()
  const keywordWhere = keyword
    ? {
        OR: [
          { username: { contains: keyword } },
          { email: { contains: keyword } },
          { displayName: { contains: keyword } },
        ],
      }
    : undefined
  const where = { ...keywordWhere, ...(input.role ? { role: input.role } : {}), ...(input.status !== undefined ? { status: input.status } : {}) }
  const [list, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        pointsBalance: true,
        walletAddress: true,
        createdAt: true,
        membershipGrants: {
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          include: { membershipLevel: true },
        },
      },
    }),
    prisma.user.count({ where }),
  ])
  return {
    total,
    list: list.map(({ membershipGrants, ...user }) => ({
      ...user,
      id: user.id.toString(),
      currentMembership: membershipSummaryFromGrants(membershipGrants, now),
      activeMemberships: activeMembershipsFromGrants(membershipGrants, now),
    })),
  }
}

export async function getManagedUser(userId: number) {
  const now = new Date()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      pointsBalance: true,
      walletAddress: true,
      createdAt: true,
      membershipGrants: {
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { membershipLevel: true },
      },
    },
  })
  if (!user) throw new HttpError('User not found', 404, 404)
  const { membershipGrants, ...profile } = user
  return {
    ...profile,
    id: profile.id.toString(),
    currentMembership: membershipSummaryFromGrants(membershipGrants, now),
    activeMemberships: activeMembershipsFromGrants(membershipGrants, now),
  }
}

export async function adjustUserPoints(input: {
  adminId: number
  userId: number
  amount: number
  description: string
}) {
  return unitOfWork.execute(
    async (tx) => {
      const current = await tx.user.findUnique({ where: { id: input.userId } })
      if (!current) throw new HttpError('User not found', 404, 404)
      const nextBalance = current.pointsBalance + input.amount
      if (nextBalance < 0) throw new HttpError('Points balance cannot be negative', 409, 409)

      const user = await tx.user.update({
        where: { id: input.userId },
        data: { pointsBalance: nextBalance, updatedAt: new Date() },
      })
      await tx.pointTransaction.create({
        data: {
          userId: input.userId,
          amount: input.amount,
          balanceAfter: nextBalance,
          type: POINT_TRANSACTION_TYPE.ADMIN_ADJUSTMENT,
          referenceId: input.adminId.toString(),
          description: input.description.trim(),
        },
      })
      return { userId: user.id.toString(), pointsBalance: user.pointsBalance }
    },
    { isolationLevel: 'Serializable' },
  )
}
