/**
 * @file user-auth.ts
 * @project SlothVault
 * @module User Authentication Service
 * @description Implements conventional registration, password login, profile and managed-avatar updates, password changes, and public user DTO mapping.
 * @logic Normalize human identifiers, hash passwords with Argon2id, enforce active identities, update login metadata, persist managed avatar references separately, and revoke existing sessions after credential changes.
 * @dependencies Prisma User model, auth/password, auth/session, auth/roles, database/unit-of-work
 * @index_tags user,registration,login,profile,avatar,password,web2
 * @author holic512
 */
import 'server-only'

import { hashPassword, verifyPassword } from '@/server/auth/password'
import { USER_ROLE, USER_STATUS } from '@/server/auth/roles'
import { issueSession } from '@/server/auth/session'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

type UserRecord = {
  id: number
  username: string
  email: string | null
  passwordConfigured: boolean
  displayName: string | null
  avatar: string | null
  bio: string | null
  role: string
  status: number
  pointsBalance: number
  walletAddress: string | null
  createdAt: Date
  updatedAt: Date
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === code
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
}

export function normalizeEmail(value: string | undefined | null) {
  return value?.trim().toLowerCase() || null
}

export function userDto(user: UserRecord) {
  return {
    id: user.id.toString(),
    username: user.username,
    email: user.email,
    passwordConfigured: user.passwordConfigured,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    role: user.role,
    pointsBalance: user.pointsBalance,
    walletAddress: user.walletAddress,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export async function registerUser(input: {
  username: string
  email?: string
  password: string
  displayName?: string
}) {
  const username = normalizeUsername(input.username)
  const email = normalizeEmail(input.email)
  const password = await hashPassword(input.password)

  try {
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password,
        displayName: input.displayName?.trim() || null,
        role: USER_ROLE.USER,
        status: USER_STATUS.ACTIVE,
      },
    })
    return { user: userDto(user), userId: user.id }
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Username or email is already registered', 409, 409)
    }
    throw error
  }
}

export async function loginUser(input: {
  identifier: string
  password: string
  remember: boolean
  ip: string | null
  userAgent: string | null
}) {
  const identifier = input.identifier.trim().toLowerCase()
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
  })
  if (
    !user ||
    user.status !== USER_STATUS.ACTIVE ||
    !(await verifyPassword(user.password, input.password))
  ) {
    throw new HttpError('Invalid credentials', 401, 401)
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), updatedAt: new Date() },
  })
  const ttlMs = (input.remember ? 30 : 7) * 24 * 60 * 60 * 1000
  const session = await issueSession({
    userId: user.id,
    ttlMs,
    ip: input.ip,
    userAgent: input.userAgent,
  })
  return { user: userDto(updated), session }
}

export async function updateUserProfile(userId: number, input: {
  email?: string | null
  displayName?: string | null
  bio?: string | null
}) {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
        ...(input.displayName !== undefined
          ? { displayName: input.displayName?.trim() || null }
          : {}),
        ...(input.bio !== undefined ? { bio: input.bio?.trim() || null } : {}),
        updatedAt: new Date(),
      },
    })
    return userDto(user)
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Email is already registered', 409, 409)
    }
    throw error
  }
}

export async function updateUserAvatar(userId: number, avatar: string | null) {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar, updatedAt: new Date() },
    })
    return userDto(user)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('User not found', 404, 404)
    throw error
  }
}

export async function changeUserPassword(userId: number, input: {
  currentPassword?: string
  newPassword: string
}) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (
    !user ||
    (user.passwordConfigured &&
      (!input.currentPassword || !(await verifyPassword(user.password, input.currentPassword))))
  ) {
    throw new HttpError('Current password is incorrect', 400, 400)
  }
  const password = await hashPassword(input.newPassword)
  await unitOfWork.execute(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password, passwordConfigured: true, updatedAt: new Date() },
    })
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })
}
