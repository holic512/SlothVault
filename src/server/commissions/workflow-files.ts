/**
 * @file workflow-files.ts
 * @project SlothVault
 * @module Private Commission Files
 * @description Streams bounded private uploads, verified downloads, delivery bundles and project archives.
 * @logic Authorize the commission before reading bytes, keep file identities immutable, and publish only frozen delivery manifests through protected routes.
 * @dependencies node streams/filesystem, archiver, managed file root, commission service
 * @index_tags commissions,uploads,delivery,files,sha256,archive,privacy
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, realpath, unlink } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { authorizeWorkflow, getWorkflow } from './workflow'
import { getCommission } from './service'
import { commissionArchive as legacyArchive } from './files'
import { digest } from './submissions'
import { verifyCommissionBytes } from './storage'
import type { CommissionActor } from './input'

export const COMMISSION_FILE_MAX_BYTES = 100 * 1024 * 1024
export const COMMISSION_PROOF_MAX_BYTES = 10 * 1024 * 1024
const allowed = new Set(['zip', 'pdf', 'txt', 'md', 'json', 'docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm'])
const purposes = ['REQUIREMENT', 'CONTRACT', 'PAYMENT', 'TEST', 'DELIVERY']
function contained(root: string, path: string) {
  const rel = relative(root, path)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new HttpError('文件路径无效', 403, 403)
  return path
}
export async function uploadCommissionFile(id: number, actor: CommissionActor, request: Request, metadata: { name: string; purpose: string; shared: boolean; commandId: string }) {
  await authorizeWorkflow(prisma, id, actor, true)
  if (metadata.purpose === 'DELIVERY') metadata.shared = false
  if (!purposes.includes(metadata.purpose) || (!actor.isAdmin && metadata.purpose === 'DELIVERY')) throw new HttpError('不允许的文件用途', 400, 400)
  if (!/^[0-9a-f-]{36}$/i.test(metadata.commandId)) throw new HttpError('上传请求标识无效', 400, 400)
  const existing = await prisma.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: metadata.commandId } } })
  if (existing) { if (existing.actorUserId !== actor.userId || existing.type !== 'FILE_DRAFT') throw new HttpError('上传标识已被其他操作使用', 409, 409); return getWorkflow(id, actor) }
  if (!metadata.name || metadata.name.length > 255 || basename(metadata.name) !== metadata.name || /[\\\0\r\n]/.test(metadata.name)) throw new HttpError('文件名无效', 400, 400)
  const extension = extname(metadata.name).slice(1).toLowerCase()
  if (!allowed.has(extension)) throw new HttpError('请使用源码 ZIP、文档、截图或 MP4/WebM 视频；安装程序可打包为 ZIP', 400, 400)
  const maxBytes = metadata.purpose === 'PAYMENT' ? COMMISSION_PROOF_MAX_BYTES : COMMISSION_FILE_MAX_BYTES
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) throw new HttpError('文件超过当前用途的大小上限', 413, 413)
  if (!request.body) throw new HttpError('未收到文件内容', 400, 400)
  await mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 })
  const root = await realpath(UPLOAD_ROOT), directory = contained(root, resolve(root, 'commission-attachment'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  contained(root, await realpath(directory))
  const filename = `${randomUUID()}.${extension}`, path = contained(directory, resolve(directory, filename))
  const handle = await open(path, 'wx', 0o600), reader = request.body.getReader(), hash = createHash('sha256')
  let size = 0, committed = false, head = Buffer.alloc(0)
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxBytes) throw new HttpError('文件超过当前用途的大小上限', 413, 413)
      if (head.length < 16) head = Buffer.concat([head, Buffer.from(chunk.value.subarray(0, 16 - head.length))])
      hash.update(chunk.value)
      let offset = 0
      while (offset < chunk.value.length) { const result = await handle.write(chunk.value, offset, chunk.value.length - offset); offset += result.bytesWritten }
    }
    if (!size) throw new HttpError('文件不能为空', 400, 400)
    if ((extension === 'pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) || (['zip', 'docx', 'xlsx', 'pptx'].includes(extension) && (head.length < 4 || head.readUInt16LE(0) !== 0x4b50))) throw new HttpError('文件内容与扩展名不一致', 400, 400)
    await handle.close()
    await unitOfWork.execute(async (tx) => {
      await authorizeWorkflow(tx, id, actor, true)
      const duplicate = await tx.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: metadata.commandId } } })
      if (duplicate) return
      const file = await tx.fileManagement.create({ data: { originalName: metadata.name, fileName: filename, filePath: `uploads/commission-attachment/${filename}`, fileSize: BigInt(size), businessType: 'CommissionAttachment', status: 1 } })
      const owned = await tx.commissionFile.create({ data: { commissionId: id, fileId: file.id, purpose: metadata.purpose, sha256: hash.digest('hex'), uploaderUserId: actor.userId, shared: false } })
      await tx.commissionEvent.create({ data: { commissionId: id, actorUserId: actor.userId, commandId: metadata.commandId, type: 'FILE_DRAFT', note: '上传附件草稿', dataJson: JSON.stringify({ fileId: owned.id, name: metadata.shared || !actor.isAdmin ? metadata.name : undefined, shared: false }) } })
      await tx.commission.update({ where: { id }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
      committed = true
    })
  } finally {
    await handle.close().catch(() => undefined)
    await reader.cancel().catch(() => undefined)
    if (!committed) await unlink(path).catch(() => undefined)
  }
  return getWorkflow(id, actor)
}
export async function verifiedCommissionFile(id: number, fileId: number, actor: CommissionActor) {
  const commission = await authorizeWorkflow(prisma, id, actor)
  if (commission.workflowVersion === 2) await getWorkflow(id, actor)
  const owned = await prisma.commissionFile.findFirst({ where: { id: fileId, commissionId: id }, include: { file: true, items: { include: { delivery: true } } } })
  if (!owned || owned.file.status !== 1 || (owned.uploaderUserId !== actor.userId && !owned.shared && !owned.items.some((i) => i.delivery.publishedAt))) throw new HttpError('文件不存在或尚未向您发布', 404, 404)
  const path = await verifyCommissionBytes(owned)
  return { path, owned }
}
function downloadHeaders(name: string, type: string) {
  return { 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
}
export async function downloadCommissionFile(id: number, fileId: number, actor: CommissionActor) {
  const { path, owned } = await verifiedCommissionFile(id, fileId, actor)
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, { headers: { ...downloadHeaders(owned.file.originalName, 'application/octet-stream'), 'Content-Length': owned.file.fileSize.toString(), 'ETag': `"${owned.sha256}"` } })
}
export async function commissionArchive(id: number, actor: CommissionActor) {
  const row = await authorizeWorkflow(prisma, id, actor)
  if (row.workflowVersion !== 2) { await getCommission(id, actor); return legacyArchive(id, actor) }
  const detail = await getWorkflow(id, actor)
  const files = []
  for (const file of detail.files.filter((item) => item.submitted)) files.push(await verifiedCommissionFile(id, Number(file.id), actor))
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('error', (error) => archive.destroy(error))
  for (const { path, owned } of files) archive.file(path, { name: `files/${owned.file.fileName}` })
  const records = await prisma.commissionSubmission.findMany({ where: { commissionId: id }, orderBy: { sequence: 'asc' }, include: { proofs: true } })
  for (const record of records) {
    if (digest(record.snapshotJson) !== record.snapshotHash) throw new HttpError('快照完整性校验失败', 409, 409)
    archive.append(record.snapshotJson, { name: `snapshots/${record.publicId}.json` })
  }
  archive.append(JSON.stringify({ protocol: 'slothvault.commission.archive', version: 1, commissionId: detail.publicId, files: detail.files.filter((file) => file.submitted), events: records.map((record) => ({ eventId: record.publicId, sequence: record.sequence, hash: record.snapshotHash, previousHash: record.previousHash, proofs: record.proofs.map((proof) => ({ network: proof.network, status: proof.status, memo: proof.memo, transactionSignature: proof.transactionSignature, signerAddress: proof.signerAddress, slot: proof.slot?.toString() || null, blockTime: proof.blockTime?.toISOString() || null })) })) }, null, 2), { name: 'manifest.json' })
  for (const agreement of detail.agreements.filter((item) => item.publishedEventId)) archive.append(agreement.body, { name: `contracts/${agreement.publicId}.md` })
  void archive.finalize().catch((error: Error) => archive.destroy(error))
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, { headers: downloadHeaders(`${detail.title}-项目归档.zip`, 'application/zip') })
}
