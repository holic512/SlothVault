/**
 * @file invitations.ts
 * @project SlothVault
 * @module Private Commission Invitations
 * @description Issues revocable one-time invitations and binds a logged-in customer atomically.
 * @logic Store only token hashes, reveal no commission content before claim, and serialize competing claims on the commission revision.
 * @dependencies node crypto, Prisma, unit-of-work, immutable submissions
 * @index_tags commissions,invitations,authorization
 * @author holic512
 */
import 'server-only'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import type { CommissionActor } from './input'
import { authorizeWorkflow, getWorkflow } from './workflow'
import { appendSubmission, digest } from './submissions'

export async function createInvitation(id: number, actor: CommissionActor, revision: number) {
  if (!actor.isAdmin) throw new HttpError('只有管理员可生成邀请', 403, 403)
  const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 7 * 86400000)
  await unitOfWork.execute(async (tx) => {
    const row = await authorizeWorkflow(tx, id, actor, true)
    if (row.subjectUserId || ['COMPLETED', 'TERMINATED'].includes(row.stage)) throw new HttpError('当前委托不能生成邀请', 409, 409)
    const locked = await tx.commission.updateMany({ where: { id, revision, subjectUserId: null }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
    if (!locked.count) throw new HttpError('委托已更新，请刷新', 409, 409)
    await tx.commissionInvitation.updateMany({ where: { commissionId: id, claimedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    await tx.commissionInvitation.create({ data: { commissionId: id, tokenHash: digest(token), expiresAt } })
  })
  return { path: `/commission-invitations/${token}`, expiresAt: expiresAt.toISOString() }
}
export async function revokeInvitation(id: number, actor: CommissionActor, revision: number) {
  if (!actor.isAdmin) throw new HttpError('只有管理员可撤销邀请', 403, 403)
  await unitOfWork.execute(async (tx) => {
    await authorizeWorkflow(tx, id, actor, true)
    const locked = await tx.commission.updateMany({ where: { id, revision }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
    if (!locked.count) throw new HttpError('委托已更新，请刷新', 409, 409)
    await tx.commissionInvitation.updateMany({ where: { commissionId: id, claimedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
  })
  return getWorkflow(id, actor)
}
export async function inspectInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError('邀请无效', 404, 404)
  const row = await prisma.commissionInvitation.findUnique({ where: { tokenHash: digest(token) } })
  if (!row) throw new HttpError('邀请无效', 404, 404)
  return { status: row.claimedAt ? 'CLAIMED' : row.revokedAt ? 'REVOKED' : row.expiresAt <= new Date() ? 'EXPIRED' : 'AVAILABLE', expiresAt: row.expiresAt.toISOString() }
}
export async function claimInvitation(token: string, actor: CommissionActor) {
  await inspectInvitation(token)
  if (actor.isAdmin) throw new HttpError('请使用普通用户账号认领', 403, 403)
  const id = await unitOfWork.execute(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: actor.userId, role: 'USER', status: 1 } })
    if (!user) throw new HttpError('请使用启用的普通用户账号', 403, 403)
    const invite = await tx.commissionInvitation.findUniqueOrThrow({ where: { tokenHash: digest(token) } })
    if (invite.claimedAt && invite.claimedById === actor.userId) return invite.commissionId
    if (invite.claimedAt || invite.revokedAt || invite.expiresAt <= new Date()) throw new HttpError('邀请已被使用、撤销或过期', 409, 409)
    const locked = await tx.commission.updateMany({ where: { id: invite.commissionId, subjectUserId: null, workflowVersion: 2, stage: { notIn: ['COMPLETED', 'TERMINATED'] } }, data: { subjectUserId: actor.userId, revision: { increment: 1 }, updatedAt: new Date() } })
    if (!locked.count) throw new HttpError('委托已被认领或关闭', 409, 409)
    const claimed = await tx.commissionInvitation.updateMany({ where: { id: invite.id, claimedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { claimedAt: new Date(), claimedById: actor.userId } })
    if (!claimed.count) throw new HttpError('邀请已失效', 409, 409)
    const row = await tx.commission.findUniqueOrThrow({ where: { id: invite.commissionId } })
    await appendSubmission(tx, row, actor, { commandId: `claim:${invite.id}`, requestHash: digest(`claim:${actor.userId}:${invite.tokenHash}`), type: 'invitation.claim', note: '用户登录后认领委托' })
    return row.id
  })
  return { id: String(id) }
}
