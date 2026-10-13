/**
 * @file admin-users.ts
 * @project SlothVault
 * @module Administrator User Management
 * @description Manages shared account roles, access, credentials, deletion previews and independent deletion history.
 * @logic Serialize administrator changes, reauthorize the actor, protect customer records and active administration, then atomically detach audit references and delete account data.
 * @dependencies Prisma User/Session models, auth/password, database/unit-of-work, user-deletion
 * @index_tags admin,users,roles,deletion,audit,password,session
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { userIdentitySchema } from '@/lib/user-attribution'
import { hashPassword } from '@/server/auth/password'
import { USER_ROLE, USER_STATUS, type UserRole } from '@/server/auth/roles'
import { unitOfWork } from '@/server/database/unit-of-work'
import { snapshotUser } from '@/server/database/user-attribution'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { normalizeEmail, normalizeUsername, userDto } from '@/server/services/user-auth'
import { detachUserAttribution, inspectUserDeletion } from './user-deletion'

export type CreateManagedUserInput = { username: string; email?: string; displayName?: string; password: string; role?: UserRole }
export type UpdateManagedUserInput = { username?: string; email?: string | null; displayName?: string | null; status?: number; role?: UserRole }
function hasPrismaCode(error: unknown, code: string) { return typeof error === 'object' && error !== null && 'code' in error && error.code === code }
function managedUserDto(user: Parameters<typeof userDto>[0]) { return { ...userDto(user), status: user.status } }

async function authorizeAccountMutation(tx: Prisma.TransactionClient, actorUserId: number, lock = true) {
  if (lock) {
    try {
      await tx.systemInstallation.update({ where: { id: 1, status: 'INSTALLED' }, data: { updatedAt: new Date() } })
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) throw new HttpError('System is not installed', 409, 409)
      throw error
    }
  }
  const actor = await tx.user.findUnique({ where: { id: actorUserId } })
  if (!actor || actor.role !== USER_ROLE.ADMIN || actor.status !== USER_STATUS.ACTIVE) throw new HttpError('Unauthorized', 401, 401)
  return actor
}
async function protectAdministrator(tx: Prisma.TransactionClient, user: { id: number; role: string; status: number }, actorUserId: number, losesAccess: boolean) {
  if (!losesAccess) return
  if (user.id === actorUserId) throw new HttpError('Cannot remove current administrator access', 400, 400, { reason: 'CURRENT_ADMIN' })
  if (user.role === 'ADMIN' && user.status === 1 && await tx.user.count({ where: { role: 'ADMIN', status: 1 } }) <= 1) throw new HttpError('Cannot remove last active administrator', 409, 409, { reason: 'LAST_ADMIN' })
}
async function revokeAccess(tx: Prisma.TransactionClient, userId: number) {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
  await tx.mcpApiKey.updateMany({ where: { userId }, data: { status: 0, updatedAt: new Date() } })
}

export async function createManagedUser(input: CreateManagedUserInput, actorUserId: number) {
  const password = await hashPassword(input.password)
  try {
    return await unitOfWork.execute(async tx => {
      await authorizeAccountMutation(tx, actorUserId)
      return managedUserDto(await tx.user.create({ data: {
        username: normalizeUsername(input.username), email: normalizeEmail(input.email), displayName: input.displayName?.trim() || null,
        password, passwordConfigured: true, role: input.role ?? USER_ROLE.USER, status: USER_STATUS.ACTIVE,
      } }))
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) throw new HttpError('Username or email is already registered', 409, 409)
    throw error
  }
}
export async function updateManagedUser(input: { actorUserId: number; userId: number; values: UpdateManagedUserInput }) {
  if (!Object.values(input.values).some(value => value !== undefined)) throw new HttpError('No fields to update', 400, 400)
  try {
    return await unitOfWork.execute(async tx => {
      await authorizeAccountMutation(tx, input.actorUserId)
      const existing = await tx.user.findUnique({ where: { id: input.userId } })
      if (!existing) throw new HttpError('User not found', 404, 404)
      const roleChanged = input.values.role !== undefined && input.values.role !== existing.role
      const disabled = input.values.status === USER_STATUS.DISABLED
      await protectAdministrator(tx, existing, input.actorUserId, disabled || (roleChanged && input.values.role === USER_ROLE.USER))
      const { username, email, displayName, status, role } = input.values
      const user = await tx.user.update({ where: { id: input.userId }, data: {
        ...(username !== undefined ? { username: normalizeUsername(username), credentialsRevision: { increment: 1 } } : {}),
        ...(email !== undefined ? { email: normalizeEmail(email) } : {}),
        ...(displayName !== undefined ? { displayName: displayName?.trim() || null } : {}),
        ...(status !== undefined ? { status } : {}), ...(role !== undefined ? { role } : {}), updatedAt: new Date(),
      } })
      if (disabled || roleChanged) await revokeAccess(tx, input.userId)
      return managedUserDto(user)
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) throw new HttpError('Username or email is already registered', 409, 409)
    throw error
  }
}
export async function disableManagedUser(input: { actorUserId: number; userId: number }) {
  const user = await updateManagedUser({ ...input, values: { status: USER_STATUS.DISABLED } })
  return { id: user.id, status: user.status }
}
export async function previewManagedUserDeletion(input: { actorUserId: number; userId: number }) {
  return unitOfWork.execute(async tx => {
    await authorizeAccountMutation(tx, input.actorUserId, false)
    if (!await tx.user.findUnique({ where: { id: input.userId } })) throw new HttpError('User not found', 404, 404)
    return inspectUserDeletion(tx, input.userId, input.actorUserId)
  }, { mode: 'read', isolationLevel: 'Serializable' })
}
export async function deleteManagedUser(input: { actorUserId: number; userId: number }) {
  try {
    return await unitOfWork.execute(async tx => {
      await authorizeAccountMutation(tx, input.actorUserId)
      const user = await tx.user.findUnique({ where: { id: input.userId } })
      if (!user) throw new HttpError('User not found', 404, 404)
      const preview = await inspectUserDeletion(tx, input.userId, input.actorUserId)
      if (!preview.allowed) throw new HttpError('Account cannot be deleted', 409, 409, { reason: 'USER_DELETE_BLOCKED', blockers: preview.blockers })
      const identity = await snapshotUser(tx, input.userId)
      const actor = await snapshotUser(tx, input.actorUserId)
      await detachUserAttribution(tx, input.userId, identity)
      await tx.membershipGrant.deleteMany({ where: { userId: input.userId } })
      await tx.fileReference.deleteMany({ where: { sourceType: 'USER_AVATAR', sourceId: input.userId } })
      const record = await tx.userDeletionRecord.create({ data: {
        publicId: randomUUID(), username: user.username, userSnapshotJson: JSON.stringify(identity), actorSnapshotJson: JSON.stringify(actor),
        summaryJson: JSON.stringify({ cleanup: preview.cleanup, retained: preview.retained }), userCreatedAt: user.createdAt,
      } })
      await tx.user.delete({ where: { id: input.userId } })
      return { id: String(input.userId), deletionRecordId: record.publicId }
    }, { isolationLevel: 'Serializable', timeout: 30000 })
  } catch (error) {
    if (hasPrismaCode(error, 'P2003') || hasPrismaCode(error, 'P2034')) throw new HttpError('Account relationships changed; refresh and retry', 409, 409, { reason: 'USER_DELETE_STALE' })
    throw error
  }
}
export async function listDeletedUsers(input: { page: number; pageSize: number; keyword?: string }) {
  const where = input.keyword?.trim() ? { username: { contains: input.keyword.trim() } } : {}
  const [list, total] = await Promise.all([
    prisma.userDeletionRecord.findMany({ where, orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.userDeletionRecord.count({ where }),
  ])
  return { total, list: list.map(row => ({ id: row.publicId, user: userIdentitySchema.parse(JSON.parse(row.userSnapshotJson)), actor: userIdentitySchema.parse(JSON.parse(row.actorSnapshotJson)), createdAt: row.userCreatedAt, deletedAt: row.deletedAt, summary: JSON.parse(row.summaryJson) as { cleanup: Record<string, number>; retained: Record<string, number> } })) }
}
export async function resetManagedUserPassword(input: { actorUserId: number; userId: number; password: string }) {
  const password = await hashPassword(input.password)
  return unitOfWork.execute(async tx => {
    await authorizeAccountMutation(tx, input.actorUserId)
    if (!await tx.user.findUnique({ where: { id: input.userId } })) throw new HttpError('User not found', 404, 404)
    const user = await tx.user.update({ where: { id: input.userId }, data: { password, passwordConfigured: true, credentialsRevision: { increment: 1 }, updatedAt: new Date() } })
    await revokeAccess(tx, input.userId)
    return managedUserDto(user)
  })
}
