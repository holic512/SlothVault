/**
 * @file admin-users.ts
 * @project SlothVault
 * @module Administrator User Management
 * @description Creates, updates, disables, and resets passwords for conventional user accounts from the protected administration surface.
 * @logic Keep new accounts in the regular-user role, preserve user-linked records by disabling rather than hard-deleting accounts, revoke sessions whenever access or credentials change, and protect active administrator access.
 * @dependencies Prisma User/Session models, auth/password, auth/roles, user-auth DTO helpers, database/unit-of-work
 * @index_tags admin,users,crud,password,session,security
 * @author holic512
 */
import 'server-only'

import { hashPassword } from '@/server/auth/password'
import { USER_ROLE, USER_STATUS } from '@/server/auth/roles'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { normalizeEmail, normalizeUsername, userDto } from '@/server/services/user-auth'

export type CreateManagedUserInput = {
  username: string
  email?: string
  displayName?: string
  password: string
}

export type UpdateManagedUserInput = {
  username?: string
  email?: string | null
  displayName?: string | null
  status?: number
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === code
}

function isEmptyUpdate(input: UpdateManagedUserInput) {
  return input.username === undefined &&
    input.email === undefined &&
    input.displayName === undefined &&
    input.status === undefined
}

function managedUserDto(user: Parameters<typeof userDto>[0]) {
  return { ...userDto(user), status: user.status }
}

function assertCanDisableUser(
  user: { id: number; role: string },
  actorUserId: number,
) {
  if (user.id === actorUserId) {
    throw new HttpError('Cannot disable the current administrator account', 400, 400)
  }
  if (user.role === USER_ROLE.ADMIN) {
    throw new HttpError('Cannot disable an administrator account', 400, 400)
  }
}

export async function createManagedUser(input: CreateManagedUserInput) {
  try {
    const password = await hashPassword(input.password)
    const user = await prisma.user.create({
      data: {
        username: normalizeUsername(input.username),
        email: normalizeEmail(input.email),
        displayName: input.displayName?.trim() || null,
        password,
        passwordConfigured: true,
        role: USER_ROLE.USER,
        status: USER_STATUS.ACTIVE,
      },
    })
    return managedUserDto(user)
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Username or email is already registered', 409, 409)
    }
    throw error
  }
}

export async function updateManagedUser(input: {
  actorUserId: number
  userId: number
  values: UpdateManagedUserInput
}) {
  if (isEmptyUpdate(input.values)) throw new HttpError('No fields to update', 400, 400)

  try {
    return await unitOfWork.execute(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id: input.userId } })
      if (!existing) throw new HttpError('User not found', 404, 404)

      const shouldDisable = input.values.status === USER_STATUS.DISABLED &&
        existing.status !== USER_STATUS.DISABLED
      if (shouldDisable) assertCanDisableUser(existing, input.actorUserId)

      const user = await tx.user.update({
        where: { id: input.userId },
        data: {
          ...(input.values.username !== undefined
            ? { username: normalizeUsername(input.values.username) }
            : {}),
          ...(input.values.email !== undefined
            ? { email: normalizeEmail(input.values.email) }
            : {}),
          ...(input.values.displayName !== undefined
            ? { displayName: input.values.displayName?.trim() || null }
            : {}),
          ...(input.values.status !== undefined ? { status: input.values.status } : {}),
          updatedAt: new Date(),
        },
      })
      if (shouldDisable) {
        await tx.session.updateMany({
          where: { userId: input.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }
      return managedUserDto(user)
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Username or email is already registered', 409, 409)
    }
    throw error
  }
}

export async function disableManagedUser(input: {
  actorUserId: number
  userId: number
}) {
  return unitOfWork.execute(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: input.userId } })
    if (!existing) throw new HttpError('User not found', 404, 404)
    assertCanDisableUser(existing, input.actorUserId)

    const user = await tx.user.update({
      where: { id: input.userId },
      data: { status: USER_STATUS.DISABLED, updatedAt: new Date() },
    })
    await tx.session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { id: user.id.toString(), status: user.status }
  })
}

export async function resetManagedUserPassword(input: {
  userId: number
  password: string
}) {
  const password = await hashPassword(input.password)
  return unitOfWork.execute(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: input.userId } })
    if (!existing) throw new HttpError('User not found', 404, 404)

    const user = await tx.user.update({
      where: { id: input.userId },
      data: { password, passwordConfigured: true, updatedAt: new Date() },
    })
    await tx.session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return managedUserDto(user)
  })
}
