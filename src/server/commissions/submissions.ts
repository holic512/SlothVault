/**
 * @file submissions.ts
 * @project SlothVault
 * @module Immutable Commission Submissions
 * @description Freezes private, canonically encoded events into a verifiable ordered hash chain.
 * @logic Verify attachment bytes, append a snapshot under the commission revision lock, and never rewrite committed evidence.
 * @dependencies node crypto, Prisma transaction, commission storage
 * @index_tags commissions,snapshots,sha256,evidence,timeline
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { HttpError } from '@/server/http/errors'
import type { SubmissionSnapshot, SnapshotAttachment } from '@/lib/commission-workflow'
import type { CommissionActor } from './input'
import { verifyCommissionBytes } from './storage'

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('快照不支持 undefined')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}
export function verifySubmissionChain(rows: Array<{ publicId: string; sequence: number; snapshotJson: string; snapshotHash: string; previousHash: string | null; type: string; createdAt: Date }>, commissionId: string) {
  let previous: string | null = null
  for (const [index, row] of rows.entries()) {
    const snapshot = JSON.parse(row.snapshotJson) as SubmissionSnapshot
    if (row.sequence !== index + 1 || row.previousHash !== previous || digest(row.snapshotJson) !== row.snapshotHash || canonicalJson(snapshot) !== row.snapshotJson || snapshot.previousHash !== previous || snapshot.sequence !== row.sequence || snapshot.eventId !== row.publicId || snapshot.commissionId !== commissionId || snapshot.type !== row.type || snapshot.submittedAt !== row.createdAt.toISOString() || snapshot.protocol !== 'slothvault.commission' || snapshot.version !== 1) throw new HttpError('委托时间轴完整性校验失败', 409, 409)
    previous = row.snapshotHash
  }
}
export async function snapshotFiles(tx: Prisma.TransactionClient, commissionId: number, actor: CommissionActor, keys: string[]): Promise<SnapshotAttachment[]> {
  const rows = await tx.commissionFile.findMany({ where: { commissionId, file: { fileName: { in: keys }, status: 1 } }, include: { file: true } })
  const result: SnapshotAttachment[] = []
  for (const key of keys) {
    const row = rows.find((item) => item.file.fileName === key)
    if (!row || (!row.shared && row.uploaderUserId !== actor.userId)) throw new HttpError('附件不存在、尚未发布或不属于您', 404, 404)
    await verifyCommissionBytes(row)
    result.push({ key, name: row.file.originalName, size: row.file.fileSize.toString(), sha256: row.sha256, purpose: row.purpose })
  }
  return result
}
export async function appendSubmission(tx: Prisma.TransactionClient, commission: { id: number; commissionId: string }, actor: CommissionActor | null, input: { commandId: string; requestHash: string; type: string; note: string; data?: Record<string, unknown>; reference?: string; fileKeys?: string[]; now?: Date }) {
  const rows = await tx.commissionSubmission.findMany({ where: { commissionId: commission.id }, orderBy: { sequence: 'asc' } })
  verifySubmissionChain(rows, commission.commissionId)
  if (input.reference && !rows.some((row) => row.publicId === input.reference)) throw new HttpError('引用的记录不属于当前委托', 400, 400)
  const now = input.now || new Date(), eventId = randomUUID(), nonce = randomUUID()
  const user = actor ? await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { username: true, displayName: true } }) : null
  const attachments = actor ? await snapshotFiles(tx, commission.id, actor, input.fileKeys || []) : []
  const snapshot: SubmissionSnapshot = {
    protocol: 'slothvault.commission', version: 1, commissionId: commission.commissionId, eventId, sequence: rows.length + 1,
    type: input.type, submittedAt: now.toISOString(), actor: { role: actor ? actor.isAdmin ? 'ADMIN' : 'USER' : 'SYSTEM', name: user ? user.displayName || user.username : '系统', commitment: digest(`${actor?.userId ?? 'SYSTEM'}:${nonce}`), nonce },
    note: input.note, data: input.data || {}, reference: input.reference || null, attachments, previousHash: rows.at(-1)?.snapshotHash || null,
  }
  const snapshotJson = canonicalJson(snapshot)
  const created = await tx.commissionSubmission.create({ data: { publicId: eventId, commissionId: commission.id, sequence: snapshot.sequence, commandId: input.commandId, requestHash: input.requestHash, actorUserId: actor?.userId ?? null, type: input.type, snapshotJson, snapshotHash: digest(snapshotJson), previousHash: snapshot.previousHash, createdAt: now } })
  if (attachments.length) await tx.commissionFile.updateMany({ where: { commissionId: commission.id, file: { fileName: { in: attachments.map((file) => file.key) } } }, data: { shared: true } })
  return created
}
