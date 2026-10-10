import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import sharp from 'sharp'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  const root = `/tmp/sv-managed-files-${process.pid}-${Date.now()}`
  const previousRoot = process.env.UPLOAD_STORAGE_PATH
  process.env.UPLOAD_STORAGE_PATH = `${root}/uploads`
  return { root, previousRoot, client: null as unknown as AppPrismaClient }
})
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: vi.fn() }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))

import { uploadAdminFileBuffer, resolveStoredUploadPath } from './admin-files'
import { createAdminArticle, updateAdminArticle } from './admin-articles'
import { createNoteContent, updateNoteContent } from './admin-notes'
import { createProjectHome, createSystemHomepage, updateSystemHomepage } from './admin-content'
import { assertManagedContentFiles } from './file-references'
import { upgradeFileClassifications } from '@/server/database/file-classification-upgrade'
import { exportDatabaseBackup } from './admin-backup/database-export'
import { parseDatabaseImportPayload } from './admin-backup/database-validation'
import { importDatabaseBackup } from './admin-backup/database-import'

const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex')

beforeEach(() => {
  mkdirSync(fixture.root, { recursive: true })
  const file = resolve(fixture.root, 'fixture.sqlite')
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter((name) => /^\d/.test(name)).sort()) {
    db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  }
  db.close()
  fixture.client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) }) as unknown as AppPrismaClient
})
afterEach(async () => { await fixture.client.$disconnect(); rmSync(fixture.root, { recursive: true, force: true }) })
afterAll(() => {
  if (fixture.previousRoot === undefined) delete process.env.UPLOAD_STORAGE_PATH
  else process.env.UPLOAD_STORAGE_PATH = fixture.previousRoot
})

describe('managed file classification and upload-before-content writes', () => {
  it('stores article/note images separately and accepts ZIP downloads only in attachment categories', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer()
    for (const businessType of ['ArticleImage', 'NoteImage'] as const) {
      const file = await uploadAdminFileBuffer({ originalName: 'diagram.PNG', businessType, buffer: png })
      expect(file.businessType).toBe(businessType)
      expect(await readFile(resolveStoredUploadPath(file.filePath))).toEqual(png)
      await expect(uploadAdminFileBuffer({ originalName: 'source.zip', businessType, buffer: zip })).rejects.toMatchObject({ status: 400, data: { reason: 'FILE_TYPE_NOT_ALLOWED', businessType } })
      await expect(uploadAdminFileBuffer({ originalName: 'broken.png', businessType, buffer: zip })).rejects.toMatchObject({ status: 400 })
    }
    for (const businessType of ['ArticleAttachment', 'NoteAttachment'] as const) {
      const file = await uploadAdminFileBuffer({ originalName: 'source.zip', businessType, buffer: zip })
      expect(await readFile(resolveStoredUploadPath(file.filePath))).toEqual(zip)
    }
    expect(await fixture.client.fileManagement.count()).toBe(4)
  })

  it('rejects unknown references without creating an article, then saves actual upload results', async () => {
    await expect(createAdminArticle({ title: 'Article', content: '[source](/uploads/article-attachment/missing.zip)' })).rejects.toMatchObject({ data: { reason: 'MANAGED_FILE_UNAVAILABLE', filePaths: ['uploads/article-attachment/missing.zip'] } })
    expect(await fixture.client.article.count()).toBe(0)
    expect(await fixture.client.fileReference.count()).toBe(0)
    const file = await uploadAdminFileBuffer({ originalName: 'source.zip', businessType: 'ArticleAttachment', buffer: zip })
    const article = await createAdminArticle({ title: 'Article', content: `[source](/${file.filePath})` })
    expect(await fixture.client.fileReference.count({ where: { sourceType: 'ARTICLE', sourceId: Number(article.id), fileId: Number(file.id) } })).toBe(1)
    await expect(updateAdminArticle(Number(article.id), { content: '[bad](/uploads/missing.zip)' })).rejects.toMatchObject({ status: 409 })
    expect((await fixture.client.article.findUniqueOrThrow({ where: { id: Number(article.id) } })).content).toBe(article.content)
    expect(await fixture.client.fileReference.count()).toBe(1)
  })

  it('blocks inactive/missing physical files and accepts a path with another active metadata record', async () => {
    const file = await uploadAdminFileBuffer({ originalName: 'source.zip', businessType: 'NoteAttachment', buffer: zip })
    const content = `[source](/${file.filePath})`
    await fixture.client.fileManagement.update({ where: { id: Number(file.id) }, data: { status: 0 } })
    await expect(fixture.client.$transaction((tx) => assertManagedContentFiles(tx, content))).rejects.toMatchObject({ status: 409 })
    await fixture.client.fileManagement.create({ data: { originalName: 'copy.zip', fileName: file.fileName, filePath: file.filePath, fileSize: 22n, businessType: 'NoteAttachment', status: 1 } })
    await expect(fixture.client.$transaction((tx) => assertManagedContentFiles(tx, content))).resolves.toBeUndefined()
    await unlink(resolveStoredUploadPath(file.filePath))
    await expect(fixture.client.$transaction((tx) => assertManagedContentFiles(tx, content))).rejects.toMatchObject({ status: 409 })
    const outside = resolve(fixture.root, 'outside.zip')
    await writeFile(outside, zip)
    await symlink(outside, resolveStoredUploadPath(file.filePath))
    await expect(fixture.client.$transaction((tx) => assertManagedContentFiles(tx, content))).rejects.toMatchObject({ status: 409 })
  })

  it('ignores external links and code examples and leaves unchanged legacy content editable as metadata', async () => {
    await expect(createAdminArticle({ title: 'Examples', content: '[external](https://external.example/uploads/no.zip)\n\n```md\n![sample](/uploads/missing.png)\n```' })).resolves.toHaveProperty('id')
    const legacy = await fixture.client.article.create({ data: { title: 'Legacy', content: '[missing](/uploads/missing.zip)', cover: '/uploads/article-cover/550e8400-e29b-41d4-a716-446655440000.png' } })
    await expect(updateAdminArticle(legacy.id, { title: 'Renamed', content: legacy.content, cover: legacy.cover })).resolves.toMatchObject({ title: 'Renamed', content: legacy.content })
    await expect(updateAdminArticle(legacy.id, { cover: '/uploads/article-cover/550e8400-e29b-41d4-a716-446655440001.png' })).rejects.toMatchObject({ status: 409 })
  })

  it('validates project-note bodies within the draft transaction and preserves old references on failure', async () => {
    const project = await fixture.client.project.create({ data: { projectName: 'Project', weight: 0, status: 1 } })
    const version = await fixture.client.projectVersion.create({ data: { projectId: project.id, version: '1', weight: 0, status: 0 } })
    const category = await fixture.client.category.create({ data: { projectVersionId: version.id, categoryName: 'Category', weight: 0, status: 1 } })
    const note = await fixture.client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Note', weight: 0, status: 1 } })
    const input = { noteInfoId: note.id, content: '[missing](/uploads/missing.zip)', versionNote: null, status: 1, isPrimary: true }
    await expect(createNoteContent(input)).rejects.toMatchObject({ status: 409 })
    expect(await fixture.client.noteContent.count()).toBe(0)
    const file = await uploadAdminFileBuffer({ originalName: 'source.zip', businessType: 'NoteAttachment', buffer: zip })
    const body = await createNoteContent({ ...input, content: `[source](/${file.filePath})` })
    expect(body.isPrimary).toBe(true)
    await expect(updateNoteContent(body.id, { content: input.content })).rejects.toMatchObject({ status: 409 })
    expect((await fixture.client.noteContent.findUniqueOrThrow({ where: { id: body.id } })).content).toBe(body.content)
    expect(await fixture.client.fileReference.count({ where: { sourceType: 'NOTE_CONTENT', sourceId: body.id } })).toBe(1)
  })

  it('upgrades legacy images once without changing paths, IDs or source bytes', async () => {
    const files = []
    for (const [type, name] of [['ArticleAttachment', 'a.PNG'], ['NoteAttachment', 'b.webp'], ['NoteAttachment', 'source.zip'], ['ArticleImage', 'new.png']] as const) {
      files.push(await fixture.client.fileManagement.create({ data: { originalName: name, fileName: name, filePath: `uploads/legacy/${name}`, fileSize: 1n, businessType: type } }))
    }
    const content = '![legacy](/uploads/legacy/a.PNG)\r\n'
    const article = await fixture.client.article.create({ data: { title: 'Legacy', content } })
    expect(await upgradeFileClassifications(fixture.client)).toEqual({ updated: 2 })
    expect(await upgradeFileClassifications(fixture.client)).toEqual({ updated: 0 })
    const updated = await fixture.client.fileManagement.findMany({ orderBy: { id: 'asc' } })
    expect(updated.map((file) => file.businessType)).toEqual(['ArticleImage', 'NoteImage', 'NoteAttachment', 'ArticleImage'])
    expect(updated.map((file) => [file.id, file.filePath])).toEqual(files.map((file) => [file.id, file.filePath]))
    expect((await fixture.client.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(content)
  })

  it('applies the same validation to homepage writes and rolls failed updates back', async () => {
    const missing = '[source](/uploads/markdown/missing.zip)'
    await expect(createSystemHomepage({ content: missing })).rejects.toMatchObject({ status: 409 })
    const project = await fixture.client.project.create({ data: { projectName: 'Homepage', weight: 0, status: 1 } })
    await expect(createProjectHome(project.id, { content: missing })).rejects.toMatchObject({ status: 409 })
    expect(await fixture.client.projectHome.count()).toBe(0)
    const file = await uploadAdminFileBuffer({ originalName: 'source.zip', businessType: 'Markdown', buffer: zip })
    const body = `[source](/${file.filePath})`
    const home = await createSystemHomepage({ content: body })
    await expect(updateSystemHomepage(Number(home.id), { content: missing })).rejects.toMatchObject({ status: 409 })
    expect((await fixture.client.systemHomepage.findUniqueOrThrow({ where: { id: Number(home.id) } })).content).toBe(body)
    expect(await fixture.client.fileReference.count({ where: { sourceType: 'SYSTEM_HOMEPAGE' } })).toBe(1)
  })

  it('round-trips explicit attachment images in 2.12 and normalizes legacy 2.11 backups', async () => {
    const admin = await fixture.client.user.create({ data: { username: 'admin', password: randomUUID(), role: 'ADMIN' } })
    await fixture.client.fileManagement.create({ data: { originalName: 'a.png', fileName: 'a.png', filePath: 'uploads/article-attachment/a.png', fileSize: 1n, businessType: 'ArticleAttachment' } })
    const backup = await exportDatabaseBackup()
    expect(backup.version).toBe('2.12.0')
    await importDatabaseBackup(parseDatabaseImportPayload({ version: backup.version, data: backup.data, mode: 'overwrite' }), { actorUserId: admin.id })
    expect((await fixture.client.fileManagement.findFirstOrThrow()).businessType).toBe('ArticleAttachment')
    await importDatabaseBackup(parseDatabaseImportPayload({ version: '2.11.0', data: backup.data, mode: 'overwrite' }), { actorUserId: admin.id })
    expect((await fixture.client.fileManagement.findFirstOrThrow()).businessType).toBe('ArticleImage')
  })
})
