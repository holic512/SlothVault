/**
 * @file membership.ts
 * @project SlothVault
 * @module Membership Entitlements
 * @description Owns configurable point-priced membership levels, immutable grants, effective access resolution, and administrator membership overrides.
 * @logic Resolve the highest active grant as the user's effective level, atomically exchange points for a new entitlement, preserve prior grants for expiry fallback, and revoke superseded grants only for explicit administrator replacement.
 * @dependencies Prisma MembershipLevel/MembershipGrant/User models, database/unit-of-work, HTTP errors, public article cache
 * @index_tags membership, entitlement, points, level, expiry, article-access, admin
 * @author holic512
 */
import 'server-only'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { invalidatePublicArticleCache } from '@/server/services/public-article-cache'

export const MEMBERSHIP_LEVEL_STATUS = {
  DISABLED: 0,
  ACTIVE: 1,
} as const

export const MEMBERSHIP_GRANT_SOURCE = {
  POINT_PURCHASE: 'POINT_PURCHASE',
  ADMIN_GRANT: 'ADMIN_GRANT',
} as const

const DAY_MS = 24 * 60 * 60 * 1000

type MembershipLevelRecord = {
  id: number
  name: string
  rank: number
  pricePoints: number
  validityDays: number | null
  status: number
  createdAt: Date
  updatedAt: Date
}

type MembershipGrantRecord = {
  id: number
  userId: number
  membershipLevelId: number
  source: string
  pointsCost: number | null
  grantedByUserId: number | null
  grantedAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
  revokedByUserId: number | null
  membershipLevel: MembershipLevelRecord
}

export type MembershipSummary = {
  id: string
  name: string
  rank: number
  expiresAt: Date | null
  source: string
} | null

export function membershipLevelDto(level: MembershipLevelRecord) {
  return {
    id: level.id.toString(),
    name: level.name,
    rank: level.rank,
    pricePoints: level.pricePoints,
    validityDays: level.validityDays,
    status: level.status,
    createdAt: level.createdAt,
    updatedAt: level.updatedAt,
  }
}

export function membershipGrantDto(grant: MembershipGrantRecord, now = new Date()) {
  return {
    id: grant.id.toString(),
    membershipLevel: membershipLevelDto(grant.membershipLevel),
    source: grant.source,
    pointsCost: grant.pointsCost,
    grantedByUserId: grant.grantedByUserId?.toString() ?? null,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    revokedByUserId: grant.revokedByUserId?.toString() ?? null,
    active: isMembershipGrantActive(grant, now),
  }
}

export function isMembershipGrantActive(
  grant: Pick<MembershipGrantRecord, 'expiresAt' | 'revokedAt'>,
  now = new Date(),
) {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > now.getTime())
}

export function membershipSummaryFromGrants(
  grants: MembershipGrantRecord[],
  now = new Date(),
): MembershipSummary {
  const active = grants
    .filter((grant) => isMembershipGrantActive(grant, now))
    .sort((left, right) => {
      const rankDifference = right.membershipLevel.rank - left.membershipLevel.rank
      if (rankDifference !== 0) return rankDifference
      const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      if (rightExpiry !== leftExpiry) return rightExpiry - leftExpiry
      return right.grantedAt.getTime() - left.grantedAt.getTime()
    })
  const grant = active[0]
  if (!grant) return null
  return {
    id: grant.membershipLevel.id.toString(),
    name: grant.membershipLevel.name,
    rank: grant.membershipLevel.rank,
    expiresAt: grant.expiresAt,
    source: grant.source,
  }
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === code
}

function activeGrantWhere(userId: number, now: Date) {
  return {
    userId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

function addDays(date: Date, days: number) {
  const value = date.getTime() + days * DAY_MS
  if (!Number.isSafeInteger(value)) throw new HttpError('Membership expiry is out of range', 400, 400)
  return new Date(value)
}

function laterDate(left: Date, right: Date) {
  return left.getTime() >= right.getTime() ? left : right
}

export async function listMembershipLevels(options: { includeDisabled?: boolean } = {}) {
  const list = await prisma.membershipLevel.findMany({
    where: options.includeDisabled ? undefined : { status: MEMBERSHIP_LEVEL_STATUS.ACTIVE },
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
  })
  return list.map(membershipLevelDto)
}

export async function createMembershipLevel(input: {
  name: string
  rank: number
  pricePoints: number
  validityDays: number | null
  status: number
}) {
  try {
    const level = await prisma.membershipLevel.create({
      data: {
        name: input.name.trim(),
        rank: input.rank,
        pricePoints: input.pricePoints,
        validityDays: input.validityDays,
        status: input.status,
      },
    })
    await invalidatePublicArticleCache()
    return membershipLevelDto(level)
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Membership level rank already exists', 409, 409)
    }
    throw error
  }
}

export async function updateMembershipLevel(input: {
  id: number
  name?: string
  rank?: number
  pricePoints?: number
  validityDays?: number | null
  status?: number
}) {
  const { id, ...values } = input
  if (Object.values(values).every((value) => value === undefined)) {
    throw new HttpError('No fields to update', 400, 400)
  }

  try {
    const level = await prisma.membershipLevel.update({
      where: { id },
      data: {
        ...(values.name !== undefined ? { name: values.name.trim() } : {}),
        ...(values.rank !== undefined ? { rank: values.rank } : {}),
        ...(values.pricePoints !== undefined ? { pricePoints: values.pricePoints } : {}),
        ...(values.validityDays !== undefined ? { validityDays: values.validityDays } : {}),
        ...(values.status !== undefined ? { status: values.status } : {}),
        updatedAt: new Date(),
      },
    })
    await invalidatePublicArticleCache()
    return membershipLevelDto(level)
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Membership level rank already exists', 409, 409)
    }
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Membership level not found', 404, 404)
    throw error
  }
}

export async function getEffectiveMembership(userId: number, now = new Date()) {
  const grants = await prisma.membershipGrant.findMany({
    where: activeGrantWhere(userId, now),
    include: { membershipLevel: true },
  })
  return membershipSummaryFromGrants(grants, now)
}

export async function getMembershipAccountData(userId: number) {
  const now = new Date()
  const [user, levels, grants] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } }),
    prisma.membershipLevel.findMany({
      where: { status: MEMBERSHIP_LEVEL_STATUS.ACTIVE },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    }),
    prisma.membershipGrant.findMany({
      where: { userId },
      include: { membershipLevel: true },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
    }),
  ])
  if (!user) throw new HttpError('User not found', 404, 404)
  return {
    pointsBalance: user.pointsBalance,
    currentMembership: membershipSummaryFromGrants(grants, now),
    levels: levels.map(membershipLevelDto),
    grants: grants.map((grant) => membershipGrantDto(grant, now)),
  }
}

function purchaseExpiry(options: {
  now: Date
  target: MembershipLevelRecord
  effective: MembershipSummary
  sameLevelGrants: MembershipGrantRecord[]
}) {
  if (!options.target.validityDays) return null
  const finiteSameLevelExpiry = options.sameLevelGrants
    .map((grant) => grant.expiresAt)
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>((latest, value) => !latest || value.getTime() > latest.getTime() ? value : latest, null)

  if (finiteSameLevelExpiry) {
    return addDays(laterDate(options.now, finiteSameLevelExpiry), options.target.validityDays)
  }
  if (options.effective?.expiresAt) {
    return addDays(laterDate(options.now, options.effective.expiresAt), options.target.validityDays)
  }
  return addDays(options.now, options.target.validityDays)
}

export async function purchaseMembership(input: { userId: number; membershipLevelId: number }) {
  const now = new Date()
  return unitOfWork.execute(async (tx) => {
    const [user, target, activeGrants] = await Promise.all([
      tx.user.findUnique({ where: { id: input.userId }, select: { id: true, pointsBalance: true } }),
      tx.membershipLevel.findUnique({ where: { id: input.membershipLevelId } }),
      tx.membershipGrant.findMany({
        where: activeGrantWhere(input.userId, now),
        include: { membershipLevel: true },
      }),
    ])
    if (!user) throw new HttpError('User not found', 404, 404)
    if (!target || target.status !== MEMBERSHIP_LEVEL_STATUS.ACTIVE) {
      throw new HttpError('Membership level is unavailable', 409, 409)
    }

    const effective = membershipSummaryFromGrants(activeGrants, now)
    if (effective && target.rank < effective.rank) {
      throw new HttpError('Cannot purchase a lower membership level while a higher level is active', 409, 409)
    }
    const sameLevelGrants = activeGrants.filter((grant) => grant.membershipLevelId === target.id)
    if (sameLevelGrants.some((grant) => grant.expiresAt === null)) {
      throw new HttpError('This membership level is already permanent', 409, 409)
    }
    if (user.pointsBalance < target.pricePoints) {
      throw new HttpError('Insufficient points balance', 409, 409)
    }

    const expiresAt = purchaseExpiry({ now, target, effective, sameLevelGrants })
    const grant = await tx.membershipGrant.create({
      data: {
        userId: user.id,
        membershipLevelId: target.id,
        source: MEMBERSHIP_GRANT_SOURCE.POINT_PURCHASE,
        pointsCost: target.pricePoints,
        grantedAt: now,
        expiresAt,
      },
      include: { membershipLevel: true },
    })
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { pointsBalance: { decrement: target.pricePoints }, updatedAt: now },
      select: { pointsBalance: true },
    })
    await tx.pointTransaction.create({
      data: {
        userId: user.id,
        amount: -target.pricePoints,
        balanceAfter: updatedUser.pointsBalance,
        type: 'MEMBERSHIP_PURCHASE',
        referenceId: grant.id.toString(),
        description: `Purchased ${target.name} membership`,
      },
    })

    return {
      pointsBalance: updatedUser.pointsBalance,
      membership: membershipSummaryFromGrants([...activeGrants, grant], now),
      grant: membershipGrantDto(grant, now),
    }
  }, { isolationLevel: 'Serializable' })
}

export async function getManagedUserMembership(userId: number) {
  const now = new Date()
  const [user, grants] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.membershipGrant.findMany({
      where: { userId },
      include: { membershipLevel: true },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
    }),
  ])
  if (!user) throw new HttpError('User not found', 404, 404)
  return {
    currentMembership: membershipSummaryFromGrants(grants, now),
    grants: grants.map((grant) => membershipGrantDto(grant, now)),
  }
}

export async function replaceManagedUserMembership(input: {
  actorUserId: number
  userId: number
  membershipLevelId: number
  expiresAt: Date | null
}) {
  const now = new Date()
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError('Membership expiry must be in the future', 400, 400)
  }
  await unitOfWork.execute(async (tx) => {
    const [user, level] = await Promise.all([
      tx.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
      tx.membershipLevel.findUnique({ where: { id: input.membershipLevelId } }),
    ])
    if (!user) throw new HttpError('User not found', 404, 404)
    if (!level) throw new HttpError('Membership level not found', 404, 404)
    await tx.membershipGrant.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: input.actorUserId },
    })
    await tx.membershipGrant.create({
      data: {
        userId: user.id,
        membershipLevelId: level.id,
        source: MEMBERSHIP_GRANT_SOURCE.ADMIN_GRANT,
        grantedByUserId: input.actorUserId,
        grantedAt: now,
        expiresAt: input.expiresAt,
      },
    })
  }, { isolationLevel: 'Serializable' })
  return getManagedUserMembership(input.userId)
}

export async function revokeManagedUserMembership(input: {
  actorUserId: number
  userId: number
}) {
  const now = new Date()
  const result = await unitOfWork.execute(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!user) throw new HttpError('User not found', 404, 404)
    return tx.membershipGrant.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: input.actorUserId },
    })
  }, { isolationLevel: 'Serializable' })
  return { revoked: result.count, ...(await getManagedUserMembership(input.userId)) }
}
