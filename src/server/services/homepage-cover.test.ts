import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { copyFile, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import sharp from 'sharp'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HOMEPAGE_COVER } from '@/lib/homepage-cover'

const fixture = vi.hoisted(() => {
  const root = `/tmp/sv-homepage-cover-${process.pid}-${Date.now()}`
  const previousRoot = process.env.UPLOAD_STORAGE_PATH
  const previousAppData = process.env.APP_DATA_PATH
  const previousBackupStorage = process.env.BACKUP_STORAGE_PATH
  process.env.UPLOAD_STORAGE_PATH = `${root}/uploads`
  process.env.APP_DATA_PATH = root
  process.env.BACKUP_STORAGE_PATH = `${root}/backups`
  return { root, previousRoot, previousAppData, previousBackupStorage, client: null as unknown as AppPrismaClient }
})
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: vi.fn() }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))

import { resolveStoredUploadPath, uploadAdminFileBuffer } from './admin-files'
import { getHomepageCoverSettings, getPublicHomepageCover, saveHomepageCoverSettings } from './homepage-cover'
import { authorizeManagedFile } from './file-access'
import { rebuildFileReferences } from './file-references'
import { getHomepageContent } from './homepage'
import { CONFIG_KEYS } from './system-config'
import { exportDatabaseBackup } from './admin-backup/database-export'
import { parseDatabaseImportPayload } from './admin-backup/database-validation'
import { importDatabaseBackup } from './admin-backup/database-import'
import { createCompleteSnapshot, readCompleteBundle } from './admin-backup/archive'
import { artifactPath } from './admin-backup/store'

describe('homepage cover persistence, file authorization and portable backup', { timeout: 30_000 }, () => {
  beforeEach(() => {
    mkdirSync(fixture.root, { recursive: true })
    const file = resolve(fixture.root, 'fixture.sqlite')
    const db = new Database(file)
    db.pragma('foreign_keys = ON')
    for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name)).sort()) {
      db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
    }
    db.close()
    fixture.client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) }) as unknown as AppPrismaClient
  }, 30_000)
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.client.$disconnect()
    rmSync(fixture.root, { recursive: true, force: true })
  }, 30_000)
  afterAll(() => {
    if (fixture.previousRoot === undefined) delete process.env.UPLOAD_STORAGE_PATH
    else process.env.UPLOAD_STORAGE_PATH = fixture.previousRoot
    if (fixture.previousAppData === undefined) delete process.env.APP_DATA_PATH
    else process.env.APP_DATA_PATH = fixture.previousAppData
    if (fixture.previousBackupStorage === undefined) delete process.env.BACKUP_STORAGE_PATH
    else process.env.BACKUP_STORAGE_PATH = fixture.previousBackupStorage
  }, 30_000)

  async function upload() {
    const buffer = await sharp({ create: { width: 6, height: 4, channels: 4, background: '#426388' } }).png().toBuffer()
    return uploadAdminFileBuffer({ originalName: 'cover.png', businessType: 'Markdown', buffer })
  }
  async function settings() {
    const file = await upload()
    return { enabled: true, filePath: file.filePath, positionX: 23, positionY: 78 }
  }

  it('keeps legacy defaults and homepage Markdown independent of the cover', async () => {
    await expect(getHomepageCoverSettings()).resolves.toEqual(DEFAULT_HOMEPAGE_COVER)
    await expect(getPublicHomepageCover()).resolves.toBeNull()
    await fixture.client.systemHomepage.create({ data: { content: '# Existing introduction' } })
    const cover = await settings()
    await saveHomepageCoverSettings(cover)
    await expect(getHomepageContent()).resolves.toBe('# Existing introduction')
    await fixture.client.systemHomepage.deleteMany()
    await expect(getHomepageContent()).resolves.toBeNull()
    await expect(getPublicHomepageCover()).resolves.toEqual(cover)
  })

  it('grants anonymous access only after save, retains dependencies while disabled and replaces or removes references', async () => {
    const cover = await settings()
    await expect(authorizeManagedFile(cover.filePath, null)).rejects.toMatchObject({ status: 403 })
    await saveHomepageCoverSettings(cover)
    await expect(getPublicHomepageCover()).resolves.toEqual(cover)
    await expect(authorizeManagedFile(cover.filePath, null)).resolves.toBeUndefined()
    await saveHomepageCoverSettings({ ...cover, enabled: false })
    await expect(getHomepageCoverSettings()).resolves.toEqual({ ...cover, enabled: false })
    await expect(getPublicHomepageCover()).resolves.toBeNull()
    expect(await fixture.client.fileReference.count()).toBe(1)
    await expect(authorizeManagedFile(cover.filePath, null)).rejects.toMatchObject({ status: 404 })
    await saveHomepageCoverSettings(cover)
    await expect(authorizeManagedFile(cover.filePath, null)).resolves.toBeUndefined()
    const replacement = await settings()
    await saveHomepageCoverSettings(replacement)
    await expect(authorizeManagedFile(cover.filePath, null)).rejects.toMatchObject({ status: 403 })
    await expect(authorizeManagedFile(replacement.filePath, null)).resolves.toBeUndefined()
    await saveHomepageCoverSettings(DEFAULT_HOMEPAGE_COVER)
    expect(await fixture.client.fileReference.count()).toBe(0)
    await expect(getHomepageCoverSettings()).resolves.toEqual(DEFAULT_HOMEPAGE_COVER)
    await expect(authorizeManagedFile(replacement.filePath, null)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects external and invalid paths, missing metadata, inactive files, missing bytes and symlink escapes without overwriting saved state', async () => {
    const cover = await settings()
    await saveHomepageCoverSettings(cover)
    for (const change of [{ filePath: 'https://external.example/cover.png' }, { filePath: 'uploads/../cover.png' }, { positionX: 101 }, { filePath: 'uploads/markdown/missing.png' }]) {
      await expect(saveHomepageCoverSettings({ ...cover, ...change })).rejects.toHaveProperty('status')
    }
    const invalid = await settings()
    await fixture.client.fileManagement.updateMany({ where: { filePath: invalid.filePath }, data: { status: 0 } })
    await expect(saveHomepageCoverSettings(invalid)).rejects.toMatchObject({ status: 409 })
    await fixture.client.fileManagement.updateMany({ where: { filePath: invalid.filePath }, data: { status: 1 } })
    await unlink(resolveStoredUploadPath(invalid.filePath))
    await expect(saveHomepageCoverSettings(invalid)).rejects.toMatchObject({ status: 409 })
    const outside = resolve(fixture.root, 'outside.png')
    await writeFile(outside, 'outside')
    await symlink(outside, resolveStoredUploadPath(invalid.filePath))
    await expect(saveHomepageCoverSettings(invalid)).rejects.toMatchObject({ status: 409 })
    await expect(getHomepageCoverSettings()).resolves.toEqual(cover)
    expect(await fixture.client.fileReference.count()).toBe(1)
  })

  it('validates actual static image bytes and refuses a restricted attachment category', async () => {
    const cover = await settings()
    await writeFile(resolveStoredUploadPath(cover.filePath), 'not an image')
    await expect(saveHomepageCoverSettings(cover)).rejects.toMatchObject({ status: 400 })
    const replacement = await settings()
    await fixture.client.fileManagement.updateMany({ where: { filePath: replacement.filePath }, data: { businessType: 'CommissionAttachment' } })
    await expect(saveHomepageCoverSettings(replacement)).rejects.toMatchObject({ status: 409 })
    await expect(getHomepageCoverSettings()).resolves.toEqual(DEFAULT_HOMEPAGE_COVER)
  })

  it.each(['jpeg', 'webp'] as const)('accepts actual static %s images', async format => {
    const buffer = await sharp({ create: { width: 6, height: 4, channels: 3, background: '#426388' } }).toFormat(format).toBuffer()
    const file = await uploadAdminFileBuffer({ originalName: `cover.${format}`, businessType: 'Markdown', buffer })
    const cover = { ...DEFAULT_HOMEPAGE_COVER, enabled: true, filePath: file.filePath }
    await expect(saveHomepageCoverSettings(cover)).resolves.toEqual(cover)
    await expect(getPublicHomepageCover()).resolves.toEqual(cover)
  })

  it('rejects format mismatches and files whose actual size exceeds the upload limit', async () => {
    const cover = await settings()
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#426388' } }).jpeg().toBuffer()
    await writeFile(resolveStoredUploadPath(cover.filePath), jpeg)
    await expect(saveHomepageCoverSettings(cover)).rejects.toMatchObject({ status: 400 })
    await writeFile(resolveStoredUploadPath(cover.filePath), Buffer.alloc(10 * 1024 * 1024 + 1))
    await expect(saveHomepageCoverSettings(cover)).rejects.toMatchObject({ status: 400, message: 'Homepage cover exceeds 10MB' })
    expect(await fixture.client.fileReference.count()).toBe(0)
  })

  it('retains anonymous access from a separate public source when the cover is disabled', async () => {
    const cover = await settings()
    await saveHomepageCoverSettings(cover)
    await fixture.client.systemHomepage.create({ data: { content: `![Shared image](/${cover.filePath})` } })
    await rebuildFileReferences(fixture.client)
    await saveHomepageCoverSettings({ ...cover, enabled: false })
    await expect(getPublicHomepageCover()).resolves.toBeNull()
    await expect(authorizeManagedFile(cover.filePath, null)).resolves.toBeUndefined()
  })

  it('rejects animated WebP and PNG images even with valid upload metadata', async () => {
    const pixels = Buffer.alloc(2 * 4 * 4)
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset < pixels.length / 2 ? offset : offset + 2] = 255
      pixels[offset + 3] = 255
    }
    const animated = await sharp(pixels, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer()
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2)
    const file = await uploadAdminFileBuffer({ originalName: 'animated.webp', businessType: 'Markdown', buffer: animated })
    await expect(saveHomepageCoverSettings({ ...DEFAULT_HOMEPAGE_COVER, enabled: true, filePath: file.filePath })).rejects.toMatchObject({ status: 400 })
    const png = await upload()
    const original = await readFile(resolveStoredUploadPath(png.filePath))
    // A valid acTL chunk marks APNG, even when the decoder renders only its default frame.
    const animationControl = Buffer.from('000000086163544c0000000200000000f38d9370', 'hex')
    await writeFile(resolveStoredUploadPath(png.filePath), Buffer.concat([original.subarray(0, 33), animationControl, original.subarray(33)]))
    await expect(saveHomepageCoverSettings({ ...DEFAULT_HOMEPAGE_COVER, enabled: true, filePath: png.filePath })).rejects.toMatchObject({ status: 400 })
  })

  it('rolls settings and reference deletions back together after indexing fails', async () => {
    const cover = await settings()
    await saveHomepageCoverSettings(cover)
    const replacement = await settings()
    const transaction = fixture.client.$transaction.bind(fixture.client)
    vi.spyOn(fixture.client, '$transaction').mockImplementationOnce((async (operation: (tx: unknown) => Promise<unknown>, options: object) => transaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === 'fileReference') return { ...target.fileReference, createMany: async () => { throw new Error('index failed') } }
        return Reflect.get(target, key)
      } })
      return operation(wrapped)
    }, options)) as typeof fixture.client.$transaction)
    await expect(saveHomepageCoverSettings(replacement)).rejects.toThrow('index failed')
    await expect(getHomepageCoverSettings()).resolves.toEqual(cover)
    const references = await fixture.client.fileReference.findMany({ include: { file: true } })
    expect(references.map(reference => reference.file.filePath)).toEqual([cover.filePath])
  })

  it('falls back when saved configuration is damaged or a managed image becomes unavailable', async () => {
    const cover = await settings()
    await saveHomepageCoverSettings(cover)
    await fixture.client.fileManagement.updateMany({ where: { filePath: cover.filePath }, data: { status: 0 } })
    await expect(getPublicHomepageCover()).resolves.toBeNull()
    await fixture.client.fileManagement.updateMany({ where: { filePath: cover.filePath }, data: { status: 1 } })
    await unlink(resolveStoredUploadPath(cover.filePath))
    await expect(getPublicHomepageCover()).resolves.toBeNull()
    await fixture.client.systemConfig.updateMany({ data: { configValue: '{broken' } })
    await expect(getHomepageCoverSettings()).resolves.toEqual(DEFAULT_HOMEPAGE_COVER)
    await expect(getPublicHomepageCover()).resolves.toBeNull()
    await expect(authorizeManagedFile(cover.filePath, null)).rejects.toMatchObject({ status: 404 })
  })

  it('round-trips image bytes, disabled state, focus and references through an actual complete backup archive', async () => {
    const admin = await fixture.client.user.create({ data: { username: 'admin', password: randomUUID(), role: 'ADMIN' } })
    const cover = { ...await settings(), enabled: false }
    await saveHomepageCoverSettings(cover)
    const bytes = await readFile(resolveStoredUploadPath(cover.filePath))
    const backup = await exportDatabaseBackup()
    const snapshot = await createCompleteSnapshot('manual', randomUUID(), async () => undefined)
    const bundle = await readCompleteBundle(artifactPath(snapshot.id), resolve(fixture.root, 'restored'))
    await saveHomepageCoverSettings(DEFAULT_HOMEPAGE_COVER)
    await unlink(resolveStoredUploadPath(cover.filePath))
    try {
      await importDatabaseBackup(bundle.payload, { actorUserId: admin.id })
      await copyFile(resolve(bundle.uploads, cover.filePath.slice('uploads/'.length)), resolveStoredUploadPath(cover.filePath))
    } finally { bundle.store.close() }
    await expect(getHomepageCoverSettings()).resolves.toEqual(cover)
    expect(await readFile(resolveStoredUploadPath(cover.filePath))).toEqual(bytes)
    const references = await fixture.client.fileReference.findMany({ include: { file: true } })
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({ sourceType: 'SYSTEM_CONFIG', projectId: null, usage: 'READ_MEDIA', file: { filePath: cover.filePath } })
    await expect(authorizeManagedFile(cover.filePath, null)).rejects.toMatchObject({ status: 404 })
    await fixture.client.fileReference.deleteMany()
    await rebuildFileReferences(fixture.client)
    expect(await fixture.client.fileReference.count()).toBe(1)
    await saveHomepageCoverSettings({ ...cover, enabled: true })
    await expect(getPublicHomepageCover()).resolves.toEqual({ ...cover, enabled: true })
    await expect(authorizeManagedFile(cover.filePath, null)).resolves.toBeUndefined()
    const invalid = structuredClone(backup)
    invalid.data.systemConfigs.find(config => config.configKey === CONFIG_KEYS.SYSTEM_HOMEPAGE_COVER)!.configValue = JSON.stringify({ ...cover, filePath: 'uploads/%2e%2e/private.png' })
    expect(() => parseDatabaseImportPayload({ version: invalid.version, data: invalid.data, mode: 'overwrite' })).toThrow(/homepage cover/)
    const stale = structuredClone(backup)
    stale.data.fileManagements.forEach(file => { file.status = 0 })
    expect(parseDatabaseImportPayload({ version: stale.version, data: stale.data, mode: 'overwrite' }).data.fileReferences).toHaveLength(1)
  })
})
