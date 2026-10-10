import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { AccessViewer } from '@/lib/content-access'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '../../../generated/prisma-sqlite/client'
import type { PrismaClient } from '../../../generated/prisma-postgresql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined, viewer: null as AccessViewer, uploadRoot: '' }))
vi.mock('@/server/services/admin-files', async (load) => ({
  ...await load<typeof import('@/server/services/admin-files')>(),
  get UPLOAD_ROOT() { return mocks.uploadRoot },
  resolveStoredUploadPath: (filePath: string) => resolve(mocks.uploadRoot, filePath.slice('uploads/'.length)),
}))
vi.mock('@/server/prisma', () => ({ get prisma() { return mocks.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => mocks.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: vi.fn() }))
vi.mock('@/server/auth/viewer', () => ({ getRequestViewer: () => mocks.viewer }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/services/maintenance-lock', () => ({ acquireMaintenanceLock: async () => () => undefined }))
import { GET as getNoteResponse, HEAD as headNoteResponse } from '@/app/api/project/[id]/v/[versionId]/note/[noteId]/route'
import { GET as getManifestResponse, HEAD as headManifestResponse } from '@/app/api/project/[id]/v/[versionId]/manifest/route'
import { GET as getEvidenceManifestResponse, HEAD as headEvidenceManifestResponse } from '@/app/api/evidence/[transactionSignature]/manifest/route'
import { POST as verifyAccessResponse } from '@/app/api/project/[id]/verify-access/route'
import { createAdminProject, updateAdminProject } from './admin-catalog/projects'
import { createAdminArticle, updateAdminArticle } from './admin-articles'
import { resolveProjectAccess } from './content-access'
import { authorizeManagedFile } from './file-access'
import { rebuildFileReferences } from './file-references'
import { getProjectNote, getProjectNoteMetadata, getProjectSidebar } from './public-projects'
import { getProjectVersionManifest, publishProjectVersion } from './project-version-release'
import { getPublicNoteContentEvidenceManifest, getPublicReleaseEvidence } from './release-evidence'
import { buildNoteMarkdownManifest } from './release-manifest'
import { getPublicArticleMetadata, resolvePublicArticleReader } from './public-articles'
import { getActiveMemberships, purchaseMembership, replaceManagedUserMembership, revokeManagedUserMembership } from './membership'
import { exportDatabaseBackup } from './admin-backup/database-export'
import { importDatabaseBackup } from './admin-backup/database-import'
import { parseDatabaseImportPayload } from './admin-backup/database-validation'
import { updateAdminNote } from './admin-notes'
import { updateAdminCategory } from './admin-catalog/categories'

describe('project permissions, file references and portable backup', () => {
  let directory: string
  let client: PrismaClient
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sv-capabilities-'))
    mocks.uploadRoot = join(directory, 'uploads')
    mkdirSync(mocks.uploadRoot, { recursive: true })
    const file = join(directory, 'test.db')
    const db = new Database(file)
    db.pragma('foreign_keys = ON')
    const migrations = resolve('prisma/providers/sqlite/migrations')
    for (const name of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) db.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
    db.close()
    client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) }) as unknown as PrismaClient
    mocks.client = client
    mocks.viewer = null
  })
  afterEach(async () => { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }) })
  async function seed() {
    const admin = await client.user.create({ data: { username: 'admin', password: 'test', role: 'ADMIN' } })
    const types = []
    for (const [name, rank] of [['A', 1], ['B', 2], ['C', 3], ['D', 100]] as const) types.push(await client.membershipLevel.create({ data: { name, rank, pricePoints: 10, validityDays: 30 } }))
    const users = []
    for (let index = 0; index < 4; index++) {
      const user = await client.user.create({ data: { username: types[index].name, password: 'test', pointsBalance: 100 } })
      await client.membershipGrant.create({ data: { userId: user.id, membershipLevelId: types[index].id, source: 'ADMIN_GRANT', grantedByUserId: admin.id } })
      users.push({ userId: user.id, role: 'USER' })
    }
    const project = await createAdminProject({ projectName: 'Restricted', readAccess: { mode: 'MEMBERSHIPS', membershipLevelIds: types.slice(0, 3).map(type => type.id) }, downloadAccess: { mode: 'MEMBERSHIPS', membershipLevelIds: [types[2].id] } })
    const projectId = Number(project.id)
    const version = await client.projectVersion.create({ data: { projectId, version: '1.0.0', status: 0, weight: 0 } })
    const category = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Guide', status: 1, weight: 0 } })
    const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Secret', status: 1, weight: 0 } })
    const files = []
    for (const name of ['source.zip', 'diagram.png', 'unused.png']) files.push(await client.fileManagement.create({ data: { originalName: name, fileName: name, filePath: `uploads/test/${name}`, fileSize: 4n, businessType: 'General', status: 1 } }))
    const content = '# Exact protected body\r\n![diagram](/uploads/test/diagram.png)\n[source](/uploads/test/source.zip)\n'
    const body = await client.noteContent.create({ data: { noteInfoId: note.id, content, status: 1, isPrimary: true, evidenceId: randomUUID() } })
    const release = await publishProjectVersion(version.id)
    const signature = '3'.repeat(88)
    await client.releaseCredential.create({ data: { projectVersionId: version.id, noteContentId: body.id, issuerUserId: admin.id, subjectType: 'NOTE_CONTENT', subjectId: body.evidenceId!, subjectHash: buildNoteMarkdownManifest(content).hash, subjectManifestVersion: 2, network: 'devnet', signerAddress: '1'.repeat(32), memo: '{}', transactionSignature: signature, status: 2, finalizedAt: new Date() } })
    return { admin, types, users, projectId, version, category, note, body, files, release, signature }
  }
  it('implements A/B reading, C downloading and no implicit access for high rank D', async () => {
    const s = await seed()
    const calls = s.users.map(viewer => resolveProjectAccess(s.projectId, viewer))
    expect((await Promise.all(calls)).map(access => [access.canRead, access.canDownload])).toEqual([[true, false], [true, false], [true, true], [false, false]])
    expect(await getProjectNoteMetadata(s.projectId, s.version.id, s.note.id)).toMatchObject({ noteTitle: 'Secret' })
    expect((await getProjectSidebar(s.projectId, s.version.id))[0].notes).toHaveLength(1)
    await expect(getProjectNote(s.projectId, s.version.id, s.note.id)).rejects.toMatchObject({ status: 401 })
    await expect(getProjectNote(s.projectId, s.version.id, s.note.id, s.users[3])).rejects.toMatchObject({ status: 403 })
    expect((await getProjectNote(s.projectId, s.version.id, s.note.id, s.users[0])).content).toBe(s.body.content)
    await expect(getProjectVersionManifest(s.version.id, { publicProjectId: s.projectId, viewer: s.users[0] })).rejects.toMatchObject({ status: 403 })
    await expect(getPublicNoteContentEvidenceManifest(s.signature, s.users[0])).rejects.toMatchObject({ status: 403 })
    expect((await getProjectVersionManifest(s.version.id, { publicProjectId: s.projectId, viewer: s.users[2] })).releaseHash).toBe(s.release.releaseHash)
    expect((await getPublicNoteContentEvidenceManifest(s.signature, s.users[2])).hash).toBe(buildNoteMarkdownManifest(s.body.content).hash)
    expect(await getPublicReleaseEvidence(s.signature)).toMatchObject({ subjectVisible: true, subjectHash: buildNoteMarkdownManifest(s.body.content).hash })
  })
  it('immediately revokes downloads without breaking reading/images or changing release bytes', async () => {
    const s = await seed()
    const original = await getProjectVersionManifest(s.version.id, { publicProjectId: s.projectId, viewer: s.users[2] })
    await updateAdminProject(s.projectId, { downloadAccess: { mode: 'DISABLED' } })
    expect((await resolveProjectAccess(s.projectId, s.users[2])).canDownload).toBe(false)
    await expect(authorizeManagedFile(s.files[0].filePath, s.users[2])).rejects.toMatchObject({ status: 403, data: { reason: 'DOWNLOAD_DISABLED' } })
    await expect(authorizeManagedFile(s.files[1].filePath, s.users[0], { projectId: s.projectId })).resolves.toBeUndefined()
    await expect(authorizeManagedFile(s.files[1].filePath, s.users[0], { download: true })).rejects.toMatchObject({ status: 403 })
    await expect(authorizeManagedFile(s.files[2].filePath, s.users[2])).rejects.toMatchObject({ status: 403 })
    const administrator = { userId: s.admin.id, role: 'ADMIN' }
    expect((await getProjectVersionManifest(s.version.id, { publicProjectId: s.projectId, viewer: administrator })).bytes).toEqual(original.bytes)
    expect((await getProjectNote(s.projectId, s.version.id, s.note.id, s.users[0])).content).toBe(s.body.content)
    await expect(getPublicNoteContentEvidenceManifest(s.signature, s.users[2])).rejects.toMatchObject({ status: 403 })
  })
  it('authorizes shared files only through actual visible references and checks explicit project context', async () => {
    const s = await seed()
    const other = await createAdminProject({ projectName: 'Public' })
    const home = await client.projectHome.create({ data: { projectId: Number(other.id), content: '[source](/uploads/test/source.zip)', status: 1 } })
    await client.$transaction(tx => rebuildFileReferences(tx))
    await expect(authorizeManagedFile(s.files[0].filePath, null)).resolves.toBeUndefined()
    await expect(authorizeManagedFile(s.files[0].filePath, s.users[0], { projectId: s.projectId })).rejects.toMatchObject({ status: 403 })
    await expect(authorizeManagedFile(s.files[1].filePath, null, { projectId: Number(other.id) })).rejects.toMatchObject({ status: 403 })
    await client.projectHome.update({ where: { id: home.id }, data: { isDeleted: true } })
    await expect(authorizeManagedFile(s.files[0].filePath, null)).rejects.toMatchObject({ status: 401 })
    await client.projectVersion.update({ where: { id: s.version.id }, data: { status: 0 } })
    await expect(authorizeManagedFile(s.files[0].filePath, s.users[2])).rejects.toMatchObject({ status: 404 })
    await expect(getProjectNote(s.projectId, s.version.id, s.note.id, s.users[2])).rejects.toMatchObject({ status: 404 })
  })
  it('keeps grants independent across purchases, type-scoped administration, expiry and sale status', async () => {
    const s = await seed()
    const viewer = s.users[0]
    const bought = await purchaseMembership({ userId: viewer.userId, membershipLevelId: s.types[2].id })
    expect(bought.activeMemberships.map(type => type.name).sort()).toEqual(['A', 'C'])
    const cExpiry = bought.activeMemberships.find(type => type.name === 'C')!.expiresAt!
    expect(cExpiry.getTime()).toBeLessThan(Date.now() + 31 * 86_400_000)
    const renewed = await purchaseMembership({ userId: viewer.userId, membershipLevelId: s.types[2].id })
    expect(renewed.activeMemberships.find(type => type.name === 'C')!.expiresAt!.getTime()).toBe(cExpiry.getTime() + 30 * 86_400_000)
    await replaceManagedUserMembership({ actorUserId: s.admin.id, userId: viewer.userId, membershipLevelId: s.types[1].id, expiresAt: null })
    expect((await getActiveMemberships(viewer.userId)).map(type => type.name).sort()).toEqual(['A', 'B', 'C'])
    await revokeManagedUserMembership({ actorUserId: s.admin.id, userId: viewer.userId, membershipLevelId: s.types[1].id })
    await client.membershipLevel.update({ where: { id: s.types[2].id }, data: { status: 0 } })
    expect((await resolveProjectAccess(s.projectId, viewer)).canDownload).toBe(true)
    await client.membershipGrant.updateMany({ where: { userId: viewer.userId, membershipLevelId: s.types[2].id }, data: { expiresAt: new Date('2020-01-01') } })
    expect(await resolveProjectAccess(s.projectId, viewer)).toMatchObject({ canRead: true, canDownload: false })
    expect(await client.pointTransaction.count({ where: { userId: viewer.userId } })).toBe(2)
  })
  it('preserves explicit permissions, grant dates, references and hashes through current export and overwrite restore', async () => {
    const s = await seed()
    await client.$transaction(tx => rebuildFileReferences(tx))
    const backup = await exportDatabaseBackup()
    expect(backup.version).toBe('2.12.0')
    const parsed = parseDatabaseImportPayload({ data: backup.data, version: backup.version, mode: 'overwrite' })
    await importDatabaseBackup(parsed)
    const restored = await exportDatabaseBackup()
    expect(restored.data.projects[0]).toMatchObject({ readAccessMode: 'MEMBERSHIPS', downloadAccessMode: 'MEMBERSHIPS' })
    expect(restored.data.membershipGrants.map(grant => [grant.source, grant.grantedAt, grant.expiresAt, grant.revokedAt])).toEqual(backup.data.membershipGrants.map(grant => [grant.source, grant.grantedAt, grant.expiresAt, grant.revokedAt]))
    expect(restored.data.noteContents[0].content).toBe(s.body.content)
    expect(restored.data.projectVersions[0].releaseHash).toBe(s.release.releaseHash)
    expect(restored.data.fileReferences.map(ref => ref.usage).sort()).toEqual(backup.data.fileReferences.map(ref => ref.usage).sort())
    const user = await client.user.findUniqueOrThrow({ where: { username: 'C' } })
    const projectId = Number(restored.data.projects[0].id)
    await expect(authorizeManagedFile(s.files[0].filePath, { userId: user.id, role: 'USER' }, { projectId })).resolves.toBeUndefined()
  })
  it('converts old backup article thresholds once and keeps old projects publicly readable', async () => {
    const s = await seed()
    await createAdminArticle({ title: 'Legacy', content: 'Body', requiredMembershipLevelId: s.types[1].id })
    const backup = await exportDatabaseBackup()
    const article = backup.data.articles[0]
    article.requiredMembershipLevelId = String(s.types[1].id)
    const parsed = parseDatabaseImportPayload({ data: backup.data, version: '2.7.0', mode: 'overwrite' })
    await importDatabaseBackup(parsed)
    const restored = await client.article.findFirstOrThrow({ include: { allowedMemberships: { include: { membershipLevel: true } } } })
    expect(restored.allowedMemberships.map(link => link.membershipLevel.name).sort()).toEqual(['B', 'C', 'D'])
    const project = await client.project.findFirstOrThrow()
    expect(await resolveProjectAccess(project.id)).toMatchObject({ canRead: true, canDownload: true })
    await client.membershipLevel.create({ data: { name: 'New', rank: 999, pricePoints: 1 } })
    expect(await client.articleMembership.count({ where: { articleId: restored.id } })).toBe(3)
    await expect(updateAdminArticle(restored.id, { allowedMembershipLevelIds: [], requiredMembershipLevelId: null })).rejects.toMatchObject({ status: 400 })
  })
  it('ignores cached article rules and high display ranks when loading protected bodies', async () => {
    const s = await seed()
    const article = await createAdminArticle({ title: 'Article', content: 'Secret article', allowedMembershipLevelIds: [s.types[0].id] })
    const id = Number(article.id)
    await client.article.update({ where: { id }, data: { status: 1, publishedAt: new Date() } })
    const stale = await getPublicArticleMetadata(id)
    expect((await resolvePublicArticleReader(stale, s.users[3])).content).toBeNull()
    await updateAdminArticle(id, { allowedMembershipLevelIds: [s.types[2].id] })
    expect((await resolvePublicArticleReader(stale, s.users[0])).content).toBeNull()
    expect((await resolvePublicArticleReader(stale, s.users[2])).content).toBe('Secret article')
  })
  it('refreshes file project associations when moving draft notes and categories', async () => {
    const s = await seed()
    const other = await createAdminProject({ projectName: 'Other' })
    const version = await client.projectVersion.create({ data: { projectId: Number(other.id), version: 'draft', status: 0, weight: 0 } })
    const category = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Draft', status: 1, weight: 0 } })
    const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Draft', status: 1, weight: 0 } })
    const body = await client.noteContent.create({ data: { noteInfoId: note.id, content: '[source](/uploads/test/source.zip)', status: 1, isPrimary: true } })
    await client.$transaction(tx => rebuildFileReferences(tx))
    const target = await client.projectVersion.create({ data: { projectId: s.projectId, version: 'new draft', status: 0, weight: 0 } })
    await updateAdminCategory(category.id, { projectVersionId: String(target.id) })
    expect((await client.fileReference.findFirstOrThrow({ where: { sourceType: 'NOTE_CONTENT', sourceId: body.id } })).projectId).toBe(s.projectId)
    const destination = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Destination', status: 1, weight: 0 } })
    await updateAdminNote(note.id, { categoryId: String(destination.id) })
    expect((await client.fileReference.findFirstOrThrow({ where: { sourceType: 'NOTE_CONTENT', sourceId: body.id } })).projectId).toBe(Number(other.id))
  })
  it('enforces both manifest routes, note GET/HEAD and compatibility access responses before 304 or body reads', async () => {
    const s = await seed()
    const params = { params: Promise.resolve({ id: String(s.projectId), versionId: String(s.version.id), noteId: String(s.note.id) }) }
    const evidenceParams = { params: Promise.resolve({ transactionSignature: s.signature }) }
    const noteRequest = new NextRequest('http://localhost/api/project/1/v/1/note/1')
    const manifestRequest = new NextRequest('http://localhost/api/project/1/v/1/manifest', { headers: { 'If-None-Match': `"${s.release.releaseHash}"` } })
    const evidenceRequest = new NextRequest(`http://localhost/api/evidence/${s.signature}/manifest`)
    for (const [viewer, expected] of [[null, 401], [s.users[0], 403], [s.users[3], 403]] as const) {
      mocks.viewer = viewer
      for (const route of [getManifestResponse, headManifestResponse]) {
        const response = await route(manifestRequest, params)
        expect(response.status).toBe(expected)
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      }
      for (const route of [getEvidenceManifestResponse, headEvidenceManifestResponse]) expect((await route(evidenceRequest, evidenceParams)).status).toBe(expected)
    }
    mocks.viewer = null
    expect((await getNoteResponse(noteRequest, params)).status).toBe(401)
    mocks.viewer = s.users[0]
    const readable = await getNoteResponse(noteRequest, params)
    expect((await readable.json()).data.content).toBe(s.body.content)
    expect(readable.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await headNoteResponse(noteRequest, params)).body).toBeNull()
    const compatibility = await verifyAccessResponse(new NextRequest('http://localhost/api/project/1/verify-access', { method: 'POST' }), params)
    expect((await compatibility.json()).data).toMatchObject({ hasAccess: true, canRead: true, canDownload: false })
    mocks.viewer = s.users[2]
    expect((await getManifestResponse(manifestRequest, params)).status).toBe(304)
    expect((await getEvidenceManifestResponse(evidenceRequest, evidenceParams)).status).toBe(200)
    await updateAdminProject(s.projectId, { downloadAccess: { mode: 'DISABLED' } })
    expect((await getManifestResponse(manifestRequest, params)).status).toBe(403)
    expect((await getEvidenceManifestResponse(evidenceRequest, evidenceParams)).status).toBe(403)
    expect((await getNoteResponse(noteRequest, params)).status).toBe(200)
  })
  it('rejects forged backup references, empty member policies and nonexistent types', async () => {
    const s = await seed()
    const backup = await exportDatabaseBackup()
    const forged = structuredClone(backup.data)
    forged.fileReferences[0].sourceId = '999999'
    expect(() => parseDatabaseImportPayload({ data: forged, version: '2.8.0' })).toThrow(/fileReference/)
    const incomplete = { ...backup.data, projects: backup.data.projects.map(project => ({ ...project, readAccessMode: undefined })) }
    expect(() => parseDatabaseImportPayload({ data: incomplete, version: '2.8.0' })).toThrow(/missing readAccessMode/)
    await expect(updateAdminProject(s.projectId, { readAccess: { mode: 'MEMBERSHIPS', membershipLevelIds: [] } })).rejects.toMatchObject({ status: 400 })
    await expect(updateAdminProject(s.projectId, { readAccess: { mode: 'MEMBERSHIPS', membershipLevelIds: [999999] } })).rejects.toMatchObject({ status: 400 })
    expect((await resolveProjectAccess(s.projectId, s.users[0])).canRead).toBe(true)
  })
  it('exposes public media only while its actual avatar or cover reference is visible', async () => {
    const s = await seed()
    await client.fileManagement.update({ where: { id: s.files[2].id }, data: { businessType: 'ProjectAvatar' } })
    await expect(authorizeManagedFile(s.files[2].filePath, null)).rejects.toMatchObject({ status: 403 })
    await updateAdminProject(s.projectId, { avatar: `/${s.files[2].filePath}` })
    await expect(authorizeManagedFile(s.files[2].filePath, null)).resolves.toBeUndefined()
    await updateAdminProject(s.projectId, { avatar: null })
    await expect(authorizeManagedFile(s.files[2].filePath, null)).rejects.toMatchObject({ status: 403 })
    const file = await client.fileManagement.create({ data: { originalName: 'cover.webp', fileName: 'cover.webp', filePath: 'uploads/article-cover/550e8400-e29b-41d4-a716-446655440000.webp', fileSize: 4n, businessType: 'ArticleCover', status: 1 } })
    mkdirSync(join(mocks.uploadRoot, 'article-cover'), { recursive: true })
    writeFileSync(join(mocks.uploadRoot, 'article-cover/550e8400-e29b-41d4-a716-446655440000.webp'), 'test')
    const cover = await createAdminArticle({ title: 'Cover', cover: '/uploads/article-cover/550e8400-e29b-41d4-a716-446655440000.webp', content: 'Body', allowedMembershipLevelIds: [s.types[2].id] })
    await client.article.update({ where: { id: Number(cover.id) }, data: { status: 1, publishedAt: new Date() } })
    await client.$transaction(tx => rebuildFileReferences(tx))
    await expect(authorizeManagedFile(file.filePath, null)).resolves.toBeUndefined()
    await client.article.update({ where: { id: Number(cover.id) }, data: { status: 0 } })
    await expect(authorizeManagedFile(file.filePath, null)).rejects.toMatchObject({ status: 404 })
  })
  it('keeps active references when backup insertion creates duplicate file paths', async () => {
    const s = await seed()
    await client.fileManagement.create({ data: { originalName: 'duplicate.zip', fileName: 'source.zip', filePath: s.files[0].filePath, fileSize: 4n, businessType: 'General', status: 0 } })
    await client.$transaction(tx => rebuildFileReferences(tx))
    await expect(authorizeManagedFile(s.files[0].filePath, s.users[2], { projectId: s.projectId })).resolves.toBeUndefined()
  })
})
