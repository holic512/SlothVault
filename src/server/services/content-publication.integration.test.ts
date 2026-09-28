import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient as SQLiteClient } from '../../../generated/prisma-sqlite/client'
import { PrismaClient as PgClient } from '../../../generated/prisma-postgresql/client'
import { PrismaClient as MyClient } from '../../../generated/prisma-mysql/client'

const mocks = vi.hoisted(() => ({ client: undefined as PgClient | undefined, provider: 'sqlite' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return mocks.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => mocks.client, configuredDatabaseProvider: () => mocks.provider }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: vi.fn() }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))
import { createAdminArticle, publishAdminArticle, withdrawAdminArticle } from './admin-articles'
import { cloneProjectVersion, getProjectVersionIntegrity, publishProjectVersion, setProjectVersionVisibility } from './project-version-release'
import { updateAdminCategory } from './admin-catalog/categories'
import { listAdminProjectVersionsByProject, updateAdminProjectVersion } from './admin-catalog/project-versions'
import { updateAdminProjectMetadataFromMcp } from './admin-catalog/projects'
import { updateAdminNote, updateNoteContent } from './admin-notes'
import { getProjectVersions } from './public-projects'
import { upgradeContentManifests } from '../database/content-manifest-upgrade'
import { buildNoteMarkdownManifest } from './release-manifest'

const providers = ['sqlite', ...(process.env.RUN_MULTI_PROVIDER_SQL_SMOKE === '1' ? ['postgresql', 'mysql'] : [])]
for (const provider of providers) describe(`${provider} publication lifecycle`, () => {
  let directory: string
  let client: PgClient
  const projectIds: number[] = []
  const userIds: number[] = []
  beforeEach(async () => {
    mocks.provider = provider
    if (provider === 'sqlite') {
      directory = mkdtempSync(join(tmpdir(), 'sv-content-v2-'))
      const file = join(directory, 'content.db')
      const bootstrap = new Database(file)
      const migrations = resolve('prisma/providers/sqlite/migrations')
      for (const name of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) bootstrap.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
      bootstrap.close()
      client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) }) as unknown as PgClient
    } else if (provider === 'postgresql') {
      if (!process.env.TEST_POSTGRES_DATABASE_URL) throw new Error('TEST_POSTGRES_DATABASE_URL required')
      client = new PgClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_POSTGRES_DATABASE_URL }) })
    } else {
      if (!process.env.TEST_MYSQL_DATABASE_URL) throw new Error('TEST_MYSQL_DATABASE_URL required')
      client = new MyClient({ adapter: new PrismaMariaDb(process.env.TEST_MYSQL_DATABASE_URL) }) as unknown as PgClient
    }
    mocks.client = client
  })
  afterEach(async () => {
    if (provider !== 'sqlite') {
      await client.project.deleteMany({ where: { id: { in: projectIds } } })
      await client.user.deleteMany({ where: { id: { in: userIds } } })
    }
    await client.$disconnect()
    projectIds.length = 0
    userIds.length = 0
    if (directory) rmSync(directory, { recursive: true, force: true })
  })
  async function seed() {
    const project = await client.project.create({ data: { projectName: randomUUID(), weight: 0, status: 1 } })
    projectIds.push(project.id)
    const version = await client.projectVersion.create({ data: { projectId: project.id, version: '1.0.0', status: 0, weight: 100 } })
    const category = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Intro', weight: 0, status: 1 } })
    const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Guide', weight: 0, status: 1 } })
    const body = await client.noteContent.create({ data: { noteInfoId: note.id, content: '# Exact body\r\n![image](/file.png)\n', status: 1, isPrimary: true } })
    return { project, version, category, note, body }
  }
  async function draft(projectId: number, name = '1.0.1') {
    return client.projectVersion.create({ data: { projectId, version: name, description: 'Keep me', weight: 7, status: 0 } })
  }
  it('publishes and withdraws articles through the same validated lifecycle', async () => {
    const article = await createAdminArticle({ title: 'Test article', content: '' })
    const id = Number(article.id)
    try {
      await expect(publishAdminArticle(id)).rejects.toThrow('Title and content')
      expect((await client.article.findUniqueOrThrow({ where: { id } })).publishedAt).toBeNull()
      await client.article.update({ where: { id }, data: { content: '# Complete body' } })
      const released = await publishAdminArticle(id)
      expect(released.status).toBe(1)
      expect(await withdrawAdminArticle(id)).toMatchObject({ status: 0, publishedAt: released.publishedAt })
      expect(await publishAdminArticle(id)).toMatchObject({ status: 1, publishedAt: released.publishedAt })
    } finally { await client.article.delete({ where: { id } }) }
  })
  it('publishes once, edits metadata without changing the digest, and atomically rejects mixed body changes', async () => {
    const s = await seed()
    const first = await publishProjectVersion(s.version.id)
    expect(await publishProjectVersion(s.version.id)).toEqual(first)
    await updateAdminProjectMetadataFromMcp(s.project.id, { projectName: 'Renamed project', avatar: '/avatar.png' })
    await updateAdminProjectVersion(s.version.id, { version: 'Renamed release', description: 'More detail', weight: 10 })
    await updateAdminCategory(s.category.id, { categoryName: 'Renamed category', status: 1, weight: 42 })
    await updateAdminNote(s.note.id, { noteTitle: 'Renamed note', weight: 9 })
    await updateNoteContent(s.body.id, { versionNote: 'Renamed body', content: s.body.content, status: 1 })
    expect(await getProjectVersionIntegrity(s.version.id)).toMatchObject({ valid: true, computedHash: first.releaseHash })
    await expect(updateNoteContent(s.body.id, { versionNote: 'Must roll back', content: 'changed' })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await expect(updateAdminCategory(s.category.id, { categoryName: 'Must roll back', status: 0 })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await expect(updateAdminNote(s.note.id, { noteTitle: 'Must roll back', status: 0 })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: s.body.id } })).toMatchObject({ versionNote: 'Renamed body', content: s.body.content })
    expect(await client.category.findUniqueOrThrow({ where: { id: s.category.id } })).toMatchObject({ categoryName: 'Renamed category', status: 1 })
  })
  it('clones into an empty existing draft, keeps its identity and trash, and permits identical-body releases', async () => {
    const s = await seed()
    const released = await publishProjectVersion(s.version.id)
    const target = await draft(s.project.id)
    const trash = await client.category.create({ data: { projectVersionId: target.id, categoryName: 'Trash', weight: 0, status: 0, isDeleted: true } })
    expect(await cloneProjectVersion(s.version.id, { targetVersionId: target.id })).toMatchObject({ id: String(target.id), version: '1.0.1', description: 'Keep me', weight: 7, isEmpty: false })
    expect(await client.category.findUniqueOrThrow({ where: { id: trash.id } })).toMatchObject({ isDeleted: true })
    const second = await publishProjectVersion(target.id)
    expect(second.releaseHash).toBe(released.releaseHash)
    expect(second.releaseId).not.toBe(released.releaseId)
    await expect(cloneProjectVersion(s.version.id, { targetVersionId: target.id })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
  })
  it('rejects nonempty and cross-project targets and serializes concurrent clones without partial trees', async () => {
    const s = await seed()
    await publishProjectVersion(s.version.id)
    const target = await draft(s.project.id)
    const outcomes = await Promise.allSettled([cloneProjectVersion(s.version.id, { targetVersionId: target.id }), cloneProjectVersion(s.version.id, { targetVersionId: target.id })])
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(await client.category.count({ where: { projectVersionId: target.id } })).toBe(1)
    await expect(cloneProjectVersion(s.version.id, { targetVersionId: target.id })).rejects.toMatchObject({ data: { reason: 'TARGET_VERSION_NOT_EMPTY' } })
    const other = await seed()
    await expect(cloneProjectVersion(s.version.id, { targetVersionId: other.version.id })).rejects.toMatchObject({ data: { reason: 'VERSION_PROJECT_MISMATCH' } })
    const empty = await draft(s.project.id, 'empty')
    if (provider === 'sqlite') {
      await client.$executeRawUnsafe("CREATE TRIGGER fail_clone BEFORE INSERT ON docs_note_content BEGIN SELECT RAISE(ABORT, 'test copy failure'); END")
      await expect(cloneProjectVersion(s.version.id, { targetVersionId: empty.id })).rejects.toThrow()
      expect(await client.category.count({ where: { projectVersionId: empty.id } })).toBe(0)
    }
    const hidden = await client.category.create({ data: { projectVersionId: empty.id, categoryName: 'Trash', weight: 0, status: 0, isDeleted: true } })
    await client.noteInfo.create({ data: { categoryId: hidden.id, noteTitle: 'Live orphan', weight: 0, status: 1 } })
    await expect(cloneProjectVersion(s.version.id, { targetVersionId: empty.id })).rejects.toMatchObject({ data: { reason: 'TARGET_VERSION_NOT_EMPTY' } })
  })
  it('orders releases by time and ID before drafts, filters public visibility, and respects explicit management sorts', async () => {
    const s = await seed()
    await publishProjectVersion(s.version.id)
    const next = await cloneProjectVersion(s.version.id, { version: '0.0.1', weight: 0 })
    await publishProjectVersion(Number(next.id))
    await client.projectVersion.updateMany({ where: { projectId: s.project.id }, data: { publishedAt: new Date('2026-09-01T00:00:00Z') } })
    const empty = await draft(s.project.id)
    const query = { projectId: s.project.id, page: 1, pageSize: 10, skip: 0, orderByField: 'publishedAt' as const, order: 'desc' as const, includeProjectInfo: false }
    expect((await listAdminProjectVersionsByProject(query)).list.map(item => item.id)).toEqual([next.id, String(s.version.id), String(empty.id)])
    expect((await listAdminProjectVersionsByProject({ ...query, pageSize: 2, skip: 1 })).list.map(item => item.id)).toEqual([String(s.version.id), String(empty.id)])
    expect((await getProjectVersions(s.project.id)).map(item => item.id)).toEqual([next.id, String(s.version.id)])
    await setProjectVersionVisibility(Number(next.id), 0)
    expect((await getProjectVersions(s.project.id)).map(item => item.id)).toEqual([String(s.version.id)])
    expect((await listAdminProjectVersionsByProject({ ...query, orderByField: 'weight' })).list[0].id).toBe(String(s.version.id))
  })
  it('rehashes legacy records idempotently, preserves identity, and stops for signed evidence', async () => {
    const s = await seed()
    const published = await publishProjectVersion(s.version.id)
    await client.projectVersion.update({ where: { id: s.version.id }, data: { manifestVersion: 1, releaseHash: 'f'.repeat(64) } })
    const user = await client.user.create({ data: { username: randomUUID(), password: 'test', role: 'ADMIN' } })
    userIds.push(user.id)
    const credential = await client.releaseCredential.create({ data: { projectVersionId: s.version.id, issuerUserId: user.id, subjectType: 'PROJECT_VERSION', subjectId: published.releaseId, subjectHash: 'f'.repeat(64), subjectManifestVersion: 1, network: 'devnet', signerAddress: 'test', memo: '{}', transactionSignature: 'test-signature' } })
    await expect(upgradeContentManifests(client)).rejects.toThrow(`credential ${credential.id}`)
    expect((await client.projectVersion.findUniqueOrThrow({ where: { id: s.version.id } })).manifestVersion).toBe(1)
    await client.releaseCredential.update({ where: { id: credential.id }, data: { transactionSignature: null } })
    const evidenceId = randomUUID()
    await client.noteContent.update({ where: { id: s.body.id }, data: { evidenceId } })
    const noteCredential = await client.releaseCredential.create({ data: { projectVersionId: s.version.id, noteContentId: s.body.id, issuerUserId: user.id, subjectType: 'NOTE_CONTENT', subjectId: evidenceId, subjectHash: 'e'.repeat(64), subjectManifestVersion: 1, network: 'devnet', signerAddress: 'test', memo: '{}' } })
    const attempt = await client.releaseCredentialAttempt.create({ data: { credentialId: credential.id, issuerUserId: user.id, signerAddress: 'test', memo: '{}', messageHash: 'e'.repeat(64), recentBlockhash: 'test', lastValidBlockHeight: 100n, expiresAt: new Date('2030-01-01') } })
    expect(await upgradeContentManifests(client)).toEqual({ updated: 1 })
    expect(await upgradeContentManifests(client)).toEqual({ updated: 0 })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: s.version.id } })).toMatchObject({ releaseId: published.releaseId, releaseHash: published.releaseHash, publishedAt: published.publishedAt, manifestVersion: 2 })
    const migratedCredential = await client.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
    expect(migratedCredential).toMatchObject({ subjectHash: published.releaseHash, subjectManifestVersion: 2 })
    expect(JSON.parse(migratedCredential.memo)).toMatchObject({ releaseHash: published.releaseHash, manifestVersion: 2 })
    const migratedNote = await client.releaseCredential.findUniqueOrThrow({ where: { id: noteCredential.id } })
    const noteHash = buildNoteMarkdownManifest(s.body.content).hash
    expect(migratedNote).toMatchObject({ subjectHash: noteHash, subjectManifestVersion: 2 })
    expect(JSON.parse(migratedNote.memo)).toMatchObject({ contentHash: noteHash, manifestVersion: 2 })
    expect(await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ expiresAt: new Date(0), failureCode: 'MANIFEST_UPGRADED' })
  })
})
