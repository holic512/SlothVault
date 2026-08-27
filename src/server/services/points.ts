/**
 * @file points.ts
 * @project SlothVault
 * @module Points and Gift Cards
 * @description Owns user point balances, immutable point transactions, secure gift-card issuance, redemption, and administrator adjustments.
 * @logic Store only SHA-256 card hashes, return plaintext codes once at issuance, serialize balance mutations, atomically consume each card, and record every balance change with its resulting balance.
 * @dependencies node:crypto, Prisma User/PointTransaction/GiftCard models, database/unit-of-work
 * @index_tags points,gift-card,redeem,ledger,admin,transaction
 * @author holic512
 */
import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { membershipSummaryFromGrants } from '@/server/services/membership'

export const GIFT_CARD_STATUS = {
  DISABLED: 0,
  ACTIVE: 1,
  REDEEMED: 2,
} as const

export const POINT_TRANSACTION_TYPE = {
  CARD_REDEEM: 'CARD_REDEEM',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
  MEMBERSHIP_PURCHASE: 'MEMBERSHIP_PURCHASE',
} as const

function normalizeGiftCardCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function giftCardHash(code: string) {
  return createHash('sha256').update(normalizeGiftCardCode(code)).digest('hex')
}

function generateGiftCardCode() {
  const value = randomBytes(10).toString('hex').toUpperCase()
  return `SV-${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15, 20)}`
}

export async function issueGiftCardBatch(input: {
  adminId: number
  name: string
  points: number
  quantity: number
  expiresAt?: Date | null
}) {
  const codes = Array.from({ length: input.quantity }, () => generateGiftCardCode())
  const uniqueCodes = new Set(codes)
  if (uniqueCodes.size !== codes.length) {
    throw new HttpError('Unable to generate unique gift cards', 500, 500)
  }

  const batch = await unitOfWork.execute(
    async (tx) => {
      const created = await tx.giftCardBatch.create({
        data: {
          name: input.name.trim(),
          points: input.points,
          quantity: input.quantity,
          expiresAt: input.expiresAt || null,
          createdById: input.adminId,
        },
      })
      await tx.giftCard.createMany({
        data: codes.map((code) => ({
          batchId: created.id,
          codeHash: giftCardHash(code),
          codeHint: `•••• ${code.slice(-9)}`,
        })),
      })
      return created
    },
    { isolationLevel: 'Serializable' },
  )

  return {
    batch: {
      id: batch.id.toString(),
      name: batch.name,
      points: batch.points,
      quantity: batch.quantity,
      expiresAt: batch.expiresAt,
      createdAt: batch.createdAt,
    },
    codes,
  }
}

export async function redeemGiftCard(userId: number, rawCode: string) {
  const codeHash = giftCardHash(rawCode)
  if (!normalizeGiftCardCode(rawCode).startsWith('SV') || normalizeGiftCardCode(rawCode).length !== 22) {
    throw new HttpError('Invalid gift card code', 400, 400)
  }

  return unitOfWork.execute(
    async (tx) => {
      const card = await tx.giftCard.findUnique({
        where: { codeHash },
        include: { batch: true },
      })
      if (!card || card.status !== GIFT_CARD_STATUS.ACTIVE) {
        throw new HttpError('Gift card is invalid or already redeemed', 409, 409)
      }
      if (card.batch.status !== GIFT_CARD_STATUS.ACTIVE) {
        throw new HttpError('Gift card batch is disabled', 409, 409)
      }
      if (card.batch.expiresAt && card.batch.expiresAt.getTime() <= Date.now()) {
        throw new HttpError('Gift card has expired', 409, 409)
      }

      const consumed = await tx.giftCard.updateMany({
        where: { id: card.id, status: GIFT_CARD_STATUS.ACTIVE, redeemedById: null },
        data: {
          status: GIFT_CARD_STATUS.REDEEMED,
          redeemedById: userId,
          redeemedAt: new Date(),
        },
      })
      if (consumed.count !== 1) {
        throw new HttpError('Gift card is invalid or already redeemed', 409, 409)
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: { pointsBalance: { increment: card.batch.points }, updatedAt: new Date() },
      })
      await tx.pointTransaction.create({
        data: {
          userId,
          amount: card.batch.points,
          balanceAfter: user.pointsBalance,
          type: POINT_TRANSACTION_TYPE.CARD_REDEEM,
          referenceId: card.id.toString(),
          description: `Redeemed ${card.batch.name}`,
        },
      })
      return {
        pointsAdded: card.batch.points,
        pointsBalance: user.pointsBalance,
        batchName: card.batch.name,
      }
    },
    { isolationLevel: 'Serializable' },
  )
}

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

export async function listGiftCardBatches(page: number, pageSize: number) {
  const [list, total] = await Promise.all([
    prisma.giftCardBatch.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        createdBy: { select: { username: true } },
        _count: { select: { cards: true } },
        cards: { where: { status: GIFT_CARD_STATUS.REDEEMED }, select: { id: true } },
      },
    }),
    prisma.giftCardBatch.count(),
  ])
  return {
    total,
    list: list.map((batch) => ({
      id: batch.id.toString(),
      name: batch.name,
      points: batch.points,
      quantity: batch._count.cards,
      redeemed: batch.cards.length,
      status: batch.status,
      expiresAt: batch.expiresAt,
      createdBy: batch.createdBy.username,
      createdAt: batch.createdAt,
    })),
  }
}

export async function listUsers(input: {
  page: number
  pageSize: number
  keyword?: string
}) {
  const now = new Date()
  const keyword = input.keyword?.trim()
  const where = keyword
    ? {
        OR: [
          { username: { contains: keyword } },
          { email: { contains: keyword } },
          { displayName: { contains: keyword } },
        ],
      }
    : undefined
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
    })),
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
