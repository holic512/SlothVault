import { createHash, randomUUID } from 'node:crypto'
import { appendFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ root: `/tmp/sv-upload-tests-${process.pid}-${Date.now()}` }))
vi.mock('@/server/services/admin-files', async load => ({ ...await load<typeof import('@/server/services/admin-files')>(), UPLOAD_ROOT: fixture.root + '/uploads' }))
import { appendBackupUpload, cancelBackupUpload, completeBackupUpload, createBackupUpload, getBackupUpload, reconcileBackupUploads, type BackupUploadRecord } from './uploads'
import { atomicJson, importPath, pinBackupSource, readJson, recordPath } from './store'
import { BACKUP_UPLOAD_CHUNK_BYTES } from './constants'

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const create = (size = 32) => createBackupUpload({ size, fileName: 'backup.zip', lastModified: 1, fingerprint: 'a'.repeat(64) }, 1)
function chunk(offset: number, body: Buffer, checksum = hash(body)) {
  return new Request('http://localhost/chunk', { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(offset), 'X-Chunk-SHA256': checksum }, body: new Uint8Array(body) })
}
beforeEach(async () => { process.env.APP_DATA_PATH = fixture.root; delete process.env.BACKUP_STORAGE_PATH; await mkdir(fixture.root + '/uploads', { recursive: true }) })
afterEach(async () => { vi.useRealTimers(); await rm(fixture.root, { recursive: true, force: true }) })

describe('durable backup uploads', () => {
  it('uploads sequential chunks, retries acknowledged slices, and completes idempotently', async () => {
    const first = Buffer.alloc(BACKUP_UPLOAD_CHUNK_BYTES, 7), last = Buffer.alloc(32, 9)
    const upload = await create(first.length + last.length)
    expect((await appendBackupUpload(upload.importId, 1, chunk(0, first))).offset).toBe(first.length)
    // Simulate losing the first response and sending the same bytes again.
    expect((await appendBackupUpload(upload.importId, 1, chunk(0, first))).offset).toBe(first.length)
    expect((await appendBackupUpload(upload.importId, 1, chunk(first.length, last))).offset).toBe(upload.size)
    expect(await completeBackupUpload(upload.importId, 1)).toEqual({ importId: upload.importId })
    expect(await completeBackupUpload(upload.importId, 1)).toEqual({ importId: upload.importId })
    expect(hash(await readFile(importPath(upload.importId)))).toBe(hash(Buffer.concat([first, last])))
  })
  it('rejects wrong owners, offsets, checksums, and incomplete or oversized slices without advancing', async () => {
    const upload = await create(), bytes = Buffer.alloc(32)
    await expect(getBackupUpload(upload.importId, 2)).rejects.toMatchObject({ status: 404 })
    await expect(appendBackupUpload(upload.importId, 2, chunk(0, bytes))).rejects.toMatchObject({ status: 404 })
    await expect(cancelBackupUpload(upload.importId, 2)).rejects.toMatchObject({ status: 404 })
    await expect(completeBackupUpload(upload.importId, 1)).rejects.toMatchObject({ status: 409 })
    await expect(appendBackupUpload(upload.importId, 1, chunk(1, bytes))).rejects.toMatchObject({ status: 409, data: { offset: 0 } })
    await expect(appendBackupUpload(upload.importId, 1, chunk(0, bytes, 'f'.repeat(64)))).rejects.toMatchObject({ status: 400 })
    await expect(appendBackupUpload(upload.importId, 1, chunk(0, Buffer.alloc(33)))).rejects.toMatchObject({ status: 413 })
    await expect(appendBackupUpload(upload.importId, 1, chunk(0, Buffer.alloc(31)))).rejects.toMatchObject({ status: 400 })
    expect((await getBackupUpload(upload.importId, 1)).offset).toBe(0)
    expect(await readdir(fixture.root + '/backups/imports')).toEqual([upload.importId + '.zip.partial'])
  })
  it('serializes concurrent repeats and rejects differing repeated content', async () => {
    const first = Buffer.alloc(BACKUP_UPLOAD_CHUNK_BYTES, 7), upload = await create(first.length + 32)
    const result = await Promise.all([appendBackupUpload(upload.importId, 1, chunk(0, first)), appendBackupUpload(upload.importId, 1, chunk(0, first))])
    expect(result.map(value => value.offset)).toEqual([first.length, first.length])
    await expect(appendBackupUpload(upload.importId, 1, chunk(0, Buffer.alloc(first.length, 8)))).rejects.toMatchObject({ status: 409 })
    expect((await lstat(importPath(upload.importId) + '.partial')).size).toBe(first.length)
  })
  it('keeps durable offsets after restart, truncates unconfirmed bytes, and removes orphan chunks', async () => {
    const first = Buffer.alloc(BACKUP_UPLOAD_CHUNK_BYTES, 7), upload = await create(first.length + 32)
    await appendBackupUpload(upload.importId, 1, chunk(0, first))
    await appendFile(importPath(upload.importId) + '.partial', Buffer.from('unconfirmed'))
    await writeFile(importPath(upload.importId) + '.partial.' + randomUUID() + '.chunk', 'abandoned')
    await reconcileBackupUploads()
    expect((await getBackupUpload(upload.importId, 1)).offset).toBe(first.length)
    expect((await lstat(importPath(upload.importId) + '.partial')).size).toBe(first.length)
    expect(await readdir(fixture.root + '/backups/imports')).toEqual([upload.importId + '.zip.partial'])
  })
  it('reconciles a completed rename whose control acknowledgement was lost', async () => {
    const upload = await create()
    await appendBackupUpload(upload.importId, 1, chunk(0, Buffer.alloc(32)))
    await rename(importPath(upload.importId) + '.partial', importPath(upload.importId))
    await reconcileBackupUploads()
    expect((await getBackupUpload(upload.importId, 1)).state).toBe('uploaded')
  })
  it('expires inactive sessions, refreshes activity, and preserves sources while pinned', async () => {
    const upload = await create()
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 23 * 3600_000)
    const refreshed = await appendBackupUpload(upload.importId, 1, chunk(0, Buffer.alloc(32)))
    expect(new Date(refreshed.expiresAt).getTime()).toBe(Date.now() + 24 * 3600_000)
    await completeBackupUpload(upload.importId, 1)
    const release = pinBackupSource({ importId: upload.importId })
    try {
      vi.setSystemTime(Date.now() + 25 * 3600_000); await reconcileBackupUploads()
      expect((await getBackupUpload(upload.importId, 1)).state).toBe('uploaded')
      await expect(cancelBackupUpload(upload.importId, 1)).rejects.toMatchObject({ status: 409 })
    } finally { release() }
    await reconcileBackupUploads()
    expect(await readJson(recordPath('imports', upload.importId))).toBeNull()
    await expect(getBackupUpload(upload.importId, 1)).rejects.toMatchObject({ status: 404 })
  })
  it('accepts aggregate sizes beyond old caps and cancels without retaining staging files', async () => {
    const upload = await create(8 * 1024 ** 3)
    expect(upload.size).toBe(8 * 1024 ** 3)
    await cancelBackupUpload(upload.importId, 1)
    expect(await readdir(fixture.root + '/backups/imports')).toEqual([])
  })
  it('recovers other sessions when an abandoned receipt has no source file', async () => {
    const upload = await create()
    const record = await readJson<BackupUploadRecord>(recordPath('imports', upload.importId))
    await rm(importPath(upload.importId) + '.partial')
    await atomicJson(recordPath('imports', upload.importId), record)
    const valid = await create(); await reconcileBackupUploads()
    expect((await getBackupUpload(valid.importId, 1)).offset).toBe(0)
  })
})
