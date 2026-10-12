import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ root: `/tmp/sv-large-backup-${process.pid}-${Date.now()}`, records: 0, pages: [] as number[] }))
vi.mock('@/server/services/admin-files', async load => ({ ...await load<typeof import('@/server/services/admin-files')>(), UPLOAD_ROOT: fixture.root + '/uploads' }))
vi.mock('@/server/database/unit-of-work', () => ({ unitOfWork: { execute: async (callback: (tx: object) => unknown) => callback(new Proxy({}, { get(_target, key) { return { findMany: async (input: { where: { id: { gt: number } }; take: number }) => {
  fixture.pages.push(input.take)
  if (key !== 'systemConfig') return []
  const count = Math.min(input.take, fixture.records - input.where.id.gt)
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ id: input.where.id.gt + index + 1, configKey: 'large-test-' + (input.where.id.gt + index + 1), configValue: 'x'.repeat(500), description: null, createdAt: new Date('2026-01-01Z'), updatedAt: new Date('2026-01-01Z') }))
} } } })) } }))
import { createCompleteSnapshot, readCompleteBundle } from './archive'
import { artifactPath } from './store'
import { updateCrc32, validateZipFile } from './zip-validation'
import { RecordStore, backupMap, backupSet, recordWhere } from './record-store'
beforeEach(async () => { process.env.APP_DATA_PATH = fixture.root; delete process.env.BACKUP_STORAGE_PATH; fixture.records = 0; fixture.pages = []; await mkdir(fixture.root + '/uploads', { recursive: true }) })
afterEach(async () => { await rm(fixture.root, { recursive: true, force: true }) })

describe('large backups without aggregate caps', () => {
  it('keeps paged views, relation queries, sort order and validation mappings correct', () => {
    const store = new RecordStore(resolve(fixture.root, 'index.sqlite'))
    try {
      for (let id = 1001; id >= 1; id--) store.put('test', { id: String(id), group: id % 2 ? 'odd' : 'even', value: id })
      const rows = store.rows<{ id: string; group: string; value: number }>('test')
      expect(Array.isArray(rows)).toBe(true); expect(rows.length).toBe(1001)
      expect(recordWhere(rows, 'group', 'even').length).toBe(500)
      const sorted = rows.filter(row => row.value % 2 === 0).sort((a, b) => a.value - b.value).map(row => row.value)
      expect(sorted[0]).toBe(2); expect(sorted[499]).toBe(1000)
      expect(Array.from(sorted.entries()).at(-1)).toEqual([499, 1000])
      expect(sorted.reduce((sum, value) => sum + value, 0)).toBe(250500)
      const map = backupMap<number>(rows), set = backupSet(rows)
      for (const row of rows) { map.set(row.id, row.value); set.add(row.id) }
      expect(map.size).toBe(1001); expect(map.get('1001')).toBe(1001)
      let total = 0; map.forEach(value => { total += value }); expect(total).toBe(501501)
      expect(Array.from(set.entries())).toHaveLength(1001)
    } finally { store.close() }
  })
  it('exports and validates more than 100,000 records and 50 MiB of NDJSON in pages of 100', async () => {
    fixture.records = 100001
    const started = Date.now()
    const snapshot = await createCompleteSnapshot('manual', randomUUID(), async phase => { process.stdout.write(`Large backup ${phase}: ${Date.now() - started} ms\n`) })
    expect(snapshot.manifest.counts.systemConfigs).toBe(100001)
    expect(snapshot.manifest.database.systemConfigs.size).toBeGreaterThan(50 * 1024 ** 2)
    expect(Math.max(...fixture.pages)).toBe(100)
    expect(snapshot.manifest).not.toHaveProperty('files')
    const bundle = await readCompleteBundle(artifactPath(snapshot.id), fixture.root + '/verify', false)
    try { expect(bundle.payload.data.systemConfigs.length).toBe(100001); expect(bundle.payload.data.systemConfigs[100000].configKey).toBe('large-test-100001') }
    finally { bundle.store.close() }
  }, 120000)
  it('exports a package above 320 MiB with a single file above 256 MiB and attachments above 1 GiB', async () => {
    const sparse = resolve(fixture.root, 'uploads/sparse.bin')
    await writeFile(sparse, ''); await truncate(sparse, 1024 ** 3 + 1)
    const block = randomBytes(1024 ** 2)
    await pipeline(Readable.from((function* () { for (let i = 0; i < 322; i++) yield block })()), createWriteStream(resolve(fixture.root, 'uploads/random.bin')))
    const snapshot = await createCompleteSnapshot('manual', randomUUID(), async () => undefined)
    expect(snapshot.size).toBeGreaterThan(320 * 1024 ** 2)
    expect(snapshot.manifest.totalFileBytes).toBeGreaterThan(1024 ** 3)
    expect(snapshot.manifest.fileCount).toBe(2)
    const bundle = await readCompleteBundle(artifactPath(snapshot.id), fixture.root + '/verify', false)
    try { expect(bundle.store.get<{ size: number }>('$files', 'random.bin')?.size).toBe(322 * 1024 ** 2) }
    finally { bundle.store.close() }
  }, 120000)
  it('writes and reads ZIP64 with more than 65,535 entries and reports metadata memory', async () => {
    const path = resolve(fixture.root, 'many.zip'), before = process.memoryUsage().rss
    const archive = archiver('zip', { forceZip64: true, zlib: { level: 1 } })
    const writing = pipeline(archive, createWriteStream(path)); void writing.catch(error => archive.destroy(error))
    for (let index = 0; index < 65536; index++) {
      const appended = once(archive, 'entry'); archive.append('', { name: `entry-${index}` }); await appended
    }
    await Promise.all([archive.finalize(), writing])
    const entries = await validateZipFile(path)
    expect(entries).toHaveLength(65536)
    expect(entries[65535].relativePath).toBe('entry-65535')
    process.stdout.write(`ZIP64 65,536 entries: RSS delta ${((process.memoryUsage().rss - before) / 1024 ** 2).toFixed(1)} MiB\n`)
  }, 120000)
  it('reads an actual entry located beyond 4 GiB from a sparse ZIP64 fixture', async () => {
    const path = resolve(fixture.root, 'offset.zip'), position = 4 * 1024 ** 3 + 16, name = Buffer.from('beyond.bin'), content = Buffer.from('zip64')
    const crc = (updateCrc32(0xffffffff, content) ^ 0xffffffff) >>> 0
    expect((updateCrc32(0xffffffff, Buffer.from('123456789')) ^ 0xffffffff) >>> 0).toBe(0xcbf43926)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(45, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26)
    const extra = Buffer.alloc(12); extra.writeUInt16LE(1); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(position), 4)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(45, 4); central.writeUInt16LE(45, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(0xffffffff, 42)
    const offset = position + local.length + name.length + content.length, centralSize = central.length + name.length + extra.length
    const end64 = Buffer.alloc(56); end64.writeUInt32LE(0x06064b50); end64.writeBigUInt64LE(44n, 4); end64.writeUInt16LE(45, 12); end64.writeUInt16LE(45, 14); end64.writeBigUInt64LE(1n, 24); end64.writeBigUInt64LE(1n, 32); end64.writeBigUInt64LE(BigInt(centralSize), 40); end64.writeBigUInt64LE(BigInt(offset), 48)
    const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + centralSize), 8); locator.writeUInt32LE(1, 16)
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(0xffffffff, 16)
    const handle = await open(path, 'wx')
    try {
      await handle.write(local, 0, local.length, 0)
      const entry = Buffer.concat([local, name, content]); await handle.write(entry, 0, entry.length, position)
      const tail = Buffer.concat([central, name, extra, end64, locator, end]); await handle.write(tail, 0, tail.length, offset)
    } finally { await handle.close() }
    expect((await stat(path)).size).toBeGreaterThan(4 * 1024 ** 3)
    const entries = await validateZipFile(path)
    expect(entries).toHaveLength(1); expect(await entries[0].entry.buffer()).toEqual(content)
    // A corrupted ZIP64 locator must fail without attempting to scan the sparse gap.
    const damaged = await open(path, 'r+'); try { await damaged.write(Buffer.alloc(8, 255), 0, 8, offset + centralSize + 56 + 8) } finally { await damaged.close() }
    await expect(validateZipFile(path)).rejects.toMatchObject({ status: 400 })
  })
})
