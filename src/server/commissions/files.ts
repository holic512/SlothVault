/**
 * @file files.ts
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
import { authorizeCommission, getCommission } from './service'
import { verifyCommissionBytes } from './storage'
import type { CommissionActor } from './input'
import { commissionDocumentMarkdown } from '@/lib/commission-document-export'
export const COMMISSION_FILE_MAX_BYTES = 100 * 1024 * 1024
export const COMMISSION_PROOF_MAX_BYTES = 10 * 1024 * 1024
const allowed = new Set(['zip', 'pdf', 'txt', 'md', 'json', 'docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm'])
const purposes = ['REQUIREMENT', 'PAYMENT', 'TEST', 'DELIVERY']
function contained(root: string, path: string) {
  const rel = relative(root, path)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new HttpError('文件路径无效', 403, 403)
  return path
}
export async function uploadCommissionFile(id: number, actor: CommissionActor, request: Request, metadata: { name: string; purpose: string; shared: boolean; commandId: string }) {
  await authorizeCommission(prisma, id, actor)
  if (metadata.purpose === 'DELIVERY') metadata.shared = false
  if (!purposes.includes(metadata.purpose) || (!actor.isAdmin && metadata.purpose === 'DELIVERY')) throw new HttpError('不允许的文件用途', 400, 400)
  if (!/^[0-9a-f-]{36}$/i.test(metadata.commandId)) throw new HttpError('上传请求标识无效', 400, 400)
  const existing = await prisma.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: metadata.commandId } } })
  if (existing) { if (existing.actorUserId !== actor.userId || existing.type !== 'FILE_UPLOADED') throw new HttpError('上传标识已被其他操作使用', 409, 409); return getCommission(id, actor) }
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
      await authorizeCommission(tx, id, actor)
      const duplicate = await tx.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: metadata.commandId } } })
      if (duplicate) return
      const file = await tx.fileManagement.create({ data: { originalName: metadata.name, fileName: filename, filePath: `uploads/commission-attachment/${filename}`, fileSize: BigInt(size), businessType: 'CommissionAttachment', status: 1 } })
      const owned = await tx.commissionFile.create({ data: { commissionId: id, fileId: file.id, purpose: metadata.purpose, sha256: hash.digest('hex'), uploaderUserId: actor.userId, shared: actor.isAdmin ? metadata.shared : true } })
      await tx.commissionEvent.create({ data: { commissionId: id, actorUserId: actor.userId, commandId: metadata.commandId, type: 'FILE_UPLOADED', note: metadata.shared || !actor.isAdmin ? `上传项目资料：${metadata.name}` : '开发方上传待发布成果文件', dataJson: JSON.stringify({ fileId: owned.id, name: metadata.shared || !actor.isAdmin ? metadata.name : undefined, shared: metadata.shared || !actor.isAdmin }) } })
      await tx.commission.update({ where: { id }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
      committed = true
    })
  } finally {
    await handle.close().catch(() => undefined)
    await reader.cancel().catch(() => undefined)
    if (!committed) await unlink(path).catch(() => undefined)
  }
  return getCommission(id, actor)
}
export async function verifiedCommissionFile(id: number, fileId: number, actor: CommissionActor) {
  await authorizeCommission(prisma, id, actor)
  const owned = await prisma.commissionFile.findFirst({ where: { id: fileId, commissionId: id }, include: { file: true, items: { include: { delivery: true } } } })
  if (!owned || owned.file.status !== 1 || (!actor.isAdmin && owned.uploaderUserId !== actor.userId && !owned.shared && !owned.items.some((i) => i.delivery.publishedAt))) throw new HttpError('文件不存在或尚未向您发布', 404, 404)
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
export async function commissionArchive(id: number, actor: CommissionActor, deliveryId?: number) {
  const detail = await getCommission(id, actor)
  const deliveries = detail.deliveries.filter((d) => d.publishedAt && (deliveryId === undefined || d.id === String(deliveryId)))
  if (deliveryId !== undefined && !deliveries.length) throw new HttpError('交付批次不存在或尚未发布', 404, 404)
  const fileIds = new Set(deliveries.flatMap((d) => d.items.flatMap((i) => i.fileId ? [Number(i.fileId)] : [])))
  if (deliveryId === undefined) for (const document of detail.documents.filter((d) => d.issuedAt)) for (const file of document.associatedFiles) fileIds.add(Number(file.id))
  const files = []
  for (const fileId of fileIds) files.push(await verifiedCommissionFile(id, fileId, actor))
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('error', (error) => archive.destroy(error))
  for (const { path, owned } of files) archive.file(path, { name: `files/${owned.id}-${owned.file.originalName}` })
  archive.append(JSON.stringify({ project: detail.title, deliveries, files: detail.files.filter((f) => fileIds.has(Number(f.id))) }, null, 2), { name: 'delivery-manifest.json' })
  if (deliveryId === undefined) {
    for (const document of detail.documents.filter((d) => d.issuedAt)) archive.append(commissionDocumentMarkdown(document), { name: `documents/${document.id}-${document.documentType}.md` })
    archive.append(JSON.stringify({ title: detail.title, subject: detail.subject, documents: detail.documents.map(({ body: _body, values: _values, ...d }) => { void _body; void _values; return d }), events: detail.events, payments: detail.payments, acceptances: detail.acceptances, settlement: detail.settlement }, null, 2), { name: 'project-records.json' })
  }
  void archive.finalize().catch((error: Error) => archive.destroy(error))
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, { headers: downloadHeaders(`${detail.title}${deliveryId ? '-交付' : '-项目归档'}.zip`, 'application/zip') })
}
