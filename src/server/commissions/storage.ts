/**
 * @file storage.ts
 * @project SlothVault
 * @module Immutable Commission Storage
 * @description Verifies that private artifact bytes match recorded metadata before publication and download.
 * @logic Resolve a contained private path, reject missing or changed bytes, and stream SHA-256 without buffering the file.
 * @dependencies node filesystem and crypto, managed upload root
 * @index_tags commissions,storage,integrity,privacy
 * @author holic512
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { HttpError } from '@/server/http/errors'
export async function verifyCommissionBytes(owned: { sha256: string; file: { businessType: string; filePath: string; fileSize: bigint } }) {
  if (owned.file.businessType !== 'CommissionAttachment' || !/^uploads\/commission-attachment\/[\w-]+\.[a-z0-9]+$/.test(owned.file.filePath)) throw new HttpError('私有文件元数据不一致', 409, 409)
  try {
    const root = await realpath(UPLOAD_ROOT), privateRoot = await realpath(resolve(root, 'commission-attachment')), path = await realpath(resolve(root, owned.file.filePath.slice('uploads/'.length)))
    for (const [base, target] of [[root, privateRoot], [privateRoot, path]]) { const rel = relative(base, target); if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new HttpError('私有文件路径无效', 403, 403) }
    if (BigInt((await stat(path)).size) !== owned.file.fileSize) throw new HttpError('文件大小与冻结记录不一致', 409, 409)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    if (hash.digest('hex') !== owned.sha256) throw new HttpError('文件校验值与冻结记录不一致', 409, 409)
    return path
  } catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') throw new HttpError('私有文件缺失，请联系开发方补充新交付批次', 404, 404); throw e }
}
export function assertDeliveryManifest(delivery: { publishedAt: Date | null; manifestJson: string; items: Array<{ fileId: number | null; label: string; url: string | null; versionNote: string }> }, files: Array<{ id: number; sha256: string; file: { originalName: string; fileSize: bigint } }>) {
  if (!delivery.publishedAt) return
  const actual = delivery.items.map((item) => { const file = files.find((f) => f.id === item.fileId); return { label: item.label, url: item.url, versionNote: item.versionNote, fileId: item.fileId, originalName: file?.file.originalName || null, sha256: file?.sha256 || null, fileSize: file?.file.fileSize.toString() || null } })
  if (JSON.stringify(actual) !== delivery.manifestJson) throw new HttpError('已发布交付清单与冻结记录不一致', 409, 409)
}

export type DocumentAttachment = { storageKey: string; originalName: string; fileSize: string; sha256: string; purpose: string }
export function documentAttachment(file: { purpose: string; sha256: string; file: { fileName: string; originalName: string; fileSize: bigint } }): DocumentAttachment {
  return { storageKey: file.file.fileName, originalName: file.file.originalName, fileSize: file.file.fileSize.toString(), sha256: file.sha256, purpose: file.purpose }
}
export function assertDocumentAttachments<T extends { purpose: string; shared: boolean; sha256: string; file: { fileName: string; originalName: string; fileSize: bigint; status: number } }>(attachments: DocumentAttachment[], files: T[]): T[] {
  if (!Array.isArray(attachments) || attachments.length > 100 || new Set(attachments.map((a) => a.storageKey)).size !== attachments.length) throw new HttpError('正式文件关联资料清单无效', 409, 409)
  return attachments.map((attachment) => {
    const file = files.find((entry) => entry.file.fileName === attachment.storageKey)
    if (!file || !file.shared || file.file.status !== 1 || !['REQUIREMENT', 'TEST'].includes(file.purpose) || JSON.stringify(documentAttachment(file)) !== JSON.stringify(attachment)) throw new HttpError('正式文件关联资料与冻结清单不一致', 409, 409)
    return file
  })
}
