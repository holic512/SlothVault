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
import { createAdminArticle, getAdminArticle, listAdminArticles, publishAdminArticle, withdrawAdminArticle } from './admin-articles'
import { cloneProjectVersion, getProjectVersionIntegrity, publishProjectVersion, setProjectVersionVisibility } from './project-version-release'
import { updateAdminCategory } from './admin-catalog/categories'
import { listAdminProjectVersionsByProject, updateAdminProjectVersion } from './admin-catalog/project-versions'
import { updateAdminProjectMetadataFromMcp } from './admin-catalog/projects'
import { createAdminNote, getAdminNote, listAdminNotes, updateAdminNote, updateNoteContent } from './admin-notes'
import { addAdminNoteTag, listAdminNoteTags, removeAdminNoteTag, renameAdminNoteTag } from './admin-note-tags'
import { getProjectVersions } from './public-projects'

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
  it('stores normalized note tags, preserves omitted updates, and clears explicit empty tags', async () => {
    const s = await seed()
    const admin = await client.user.create({ data: { username: randomUUID(), password: 'test', role: 'ADMIN' } })
    userIds.push(admin.id)
    const created = await createAdminNote({ categoryId: String(s.category.id), authorId: admin.id, noteTitle: 'Tagged', tags: [' API ', '', 'API', 'api', '中文'] })
    const id = Number(created.id)
    expect(created.tags).toEqual(['API', 'api', '中文'])
    expect((await getAdminNote(id)).tags).toEqual(created.tags)
    expect((await listAdminNotes({ page: 1, pageSize: 100, skip: 0, keyword: '', categoryId: s.category.id, orderByField: 'weight', order: 'asc' })).list.find(note => note.id === created.id)?.tags).toEqual(created.tags)
    expect((await updateAdminNote(id, { noteTitle: 'Renamed' })).tags).toEqual(created.tags)
    expect((await updateAdminNote(id, { tags: [' new ', 'new'] })).tags).toEqual(['new'])
    expect((await getAdminNote(id)).tags).toEqual(['new'])
    expect((await updateAdminNote(id, { tags: [] })).tags).toEqual([])
    for (const tags of [null, 'tag', [42], ['x'.repeat(31)], Array.from({ length: 11 }, (_, i) => String(i))]) {
      await expect(updateAdminNote(id, { tags })).rejects.toMatchObject({ status: 400 })
    }
    expect((await getAdminNote(id)).tags).toEqual([])
  })
  it('freezes published tags, retains them in cloned drafts, and leaves release hashes unchanged', async () => {
    const s = await seed()
    await updateAdminNote(s.note.id, { tags: ['API', '教程'] })
    const released = await publishProjectVersion(s.version.id)
    await expect(updateAdminNote(s.note.id, { tags: ['changed'] })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await expect(updateAdminNote(s.note.id, { tags: [] })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    expect((await updateAdminNote(s.note.id, { weight: 2 })).tags).toEqual(['API', '教程'])
    const cloned = await cloneProjectVersion(s.version.id, { version: '1.0.1' })
    const clone = await client.noteInfo.findFirstOrThrow({ where: { category: { projectVersionId: Number(cloned.id) } } })
    expect((await getAdminNote(clone.id)).tags).toEqual(['API', '教程'])
    await updateAdminNote(clone.id, { tags: ['different'] })
    const nextRelease = await publishProjectVersion(Number(cloned.id))
    expect(nextRelease.releaseHash).not.toBe(released.releaseHash)
    expect((await getProjectVersionIntegrity(s.version.id)).valid).toBe(true)
  })
  it('supports single-tag operations without modifying other note fields or tags', async () => {
    const s = await seed()
    await updateAdminNote(s.note.id, { tags: ['keep', 'API'] })
    expect(await listAdminNoteTags(s.note.id)).toEqual({ noteId: String(s.note.id), tags: ['keep', 'API'] })
    expect((await addAdminNoteTag(s.note.id, ' new ')).tags).toEqual(['keep', 'API', 'new'])
    expect((await addAdminNoteTag(s.note.id, 'new')).tags).toEqual(['keep', 'API', 'new'])
    expect((await renameAdminNoteTag(s.note.id, ' API ', '接口')).tags).toEqual(['keep', '接口', 'new'])
    expect((await renameAdminNoteTag(s.note.id, '接口', '接口')).tags).toEqual(['keep', '接口', 'new'])
    expect((await removeAdminNoteTag(s.note.id, ' new ')).tags).toEqual(['keep', '接口'])
    expect((await removeAdminNoteTag(s.note.id, 'missing')).tags).toEqual(['keep', '接口'])
    await expect(renameAdminNoteTag(s.note.id, 'missing', 'other')).rejects.toMatchObject({ status: 404 })
    await expect(renameAdminNoteTag(s.note.id, '接口', 'keep')).rejects.toMatchObject({ status: 409 })
    const current = await getAdminNote(s.note.id)
    expect(current).toMatchObject({ noteTitle: s.note.noteTitle, categoryId: String(s.category.id), weight: 0, status: 1, tags: ['keep', '接口'] })
    await removeAdminNoteTag(s.note.id, 'keep')
    expect((await removeAdminNoteTag(s.note.id, '接口')).tags).toEqual([])
  })
  it('validates single tags and enforces capacity without discarding the current list', async () => {
    const s = await seed()
    const tags = Array.from({ length: 10 }, (_, i) => String(i))
    await updateAdminNote(s.note.id, { tags })
    expect((await addAdminNoteTag(s.note.id, '0')).tags).toEqual(tags)
    await expect(addAdminNoteTag(s.note.id, 'overflow')).rejects.toMatchObject({ status: 400 })
    for (const tag of [null, 42, '', '  ', 'x'.repeat(31)]) {
      await expect(addAdminNoteTag(s.note.id, tag)).rejects.toMatchObject({ status: 400 })
      await expect(removeAdminNoteTag(s.note.id, tag)).rejects.toMatchObject({ status: 400 })
      await expect(renameAdminNoteTag(s.note.id, '0', tag)).rejects.toMatchObject({ status: 400 })
    }
    expect((await listAdminNoteTags(s.note.id)).tags).toEqual(tags)
    await expect(listAdminNoteTags(2147483647)).rejects.toMatchObject({ status: 404 })
    await client.noteInfo.update({ where: { id: s.note.id }, data: { isDeleted: true } })
    await expect(listAdminNoteTags(s.note.id)).rejects.toMatchObject({ status: 404 })
    await expect(addAdminNoteTag(s.note.id, 'new')).rejects.toMatchObject({ status: 404 })
  })
  it('keeps published tags readable and rejects all single-tag writes including no-ops', async () => {
    const s = await seed()
    await updateAdminNote(s.note.id, { tags: ['API'] })
    await publishProjectVersion(s.version.id)
    expect((await listAdminNoteTags(s.note.id)).tags).toEqual(['API'])
    for (const operation of [
      () => addAdminNoteTag(s.note.id, 'API'),
      () => removeAdminNoteTag(s.note.id, 'missing'),
      () => renameAdminNoteTag(s.note.id, 'API', 'API'),
    ]) await expect(operation()).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    expect((await listAdminNoteTags(s.note.id)).tags).toEqual(['API'])
  })
  it('preserves simultaneous additions on the same note', async () => {
    const s = await seed()
    await updateAdminNote(s.note.id, { tags: ['keep'] })
    await Promise.all([addAdminNoteTag(s.note.id, 'first'), addAdminNoteTag(s.note.id, 'second')])
    expect((await listAdminNoteTags(s.note.id)).tags).toEqual(expect.arrayContaining(['keep', 'first', 'second']))
    expect((await listAdminNoteTags(s.note.id)).tags).toHaveLength(3)
  })
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

  it('reads body-free lists and full details against the real database', async () => {
    const article = await createAdminArticle({ title: 'List/detail regression', content: 'Only in detail' })
    const listed = await listAdminArticles({ page: 1, pageSize: 10, skip: 0, keyword: 'List/detail regression', status: 0 })
    expect(listed.list.find(item => item.id === article.id)).toMatchObject({ title: article.title, summary: null })
    expect(listed.list.every(item => !('content' in item))).toBe(true)
    expect(await getAdminArticle(Number(article.id))).toMatchObject({ content: 'Only in detail' })
  })
  it('publishes once, edits metadata without changing the digest, and atomically rejects mixed body changes', async () => {
    const s = await seed()
    const first = await publishProjectVersion(s.version.id)
    expect(await publishProjectVersion(s.version.id)).toEqual(first)
    await updateAdminProjectMetadataFromMcp(s.project.id, { projectName: 'Renamed project', avatar: '/avatar.png' })
    await expect(updateAdminProjectVersion(s.version.id, { version: 'Renamed release' })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await updateAdminProjectVersion(s.version.id, { description: 'More detail', weight: 10 })
    await expect(updateAdminCategory(s.category.id, { categoryName: 'Renamed category' })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await updateAdminCategory(s.category.id, { status: 1, weight: 42 })
    await expect(updateAdminNote(s.note.id, { noteTitle: 'Renamed note' })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await updateAdminNote(s.note.id, { weight: 9 })
    await updateNoteContent(s.body.id, { versionNote: 'Renamed body', content: s.body.content, status: 1 })
    expect(await getProjectVersionIntegrity(s.version.id)).toMatchObject({ valid: true, computedHash: first.releaseHash })
    await expect(updateNoteContent(s.body.id, { versionNote: 'Must roll back', content: 'changed' })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await expect(updateAdminCategory(s.category.id, { categoryName: 'Must roll back', status: 0 })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    await expect(updateAdminNote(s.note.id, { noteTitle: 'Must roll back', status: 0 })).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: s.body.id } })).toMatchObject({ versionNote: 'Renamed body', content: s.body.content })
    expect(await client.category.findUniqueOrThrow({ where: { id: s.category.id } })).toMatchObject({ categoryName: s.category.categoryName, status: 1 })
  })
  it('clones into an empty existing draft, keeps its identity and trash, and permits identical-body releases', async () => {
    const s = await seed()
    const released = await publishProjectVersion(s.version.id)
    const target = await draft(s.project.id)
    const trash = await client.category.create({ data: { projectVersionId: target.id, categoryName: 'Trash', weight: 0, status: 0, isDeleted: true } })
    expect(await cloneProjectVersion(s.version.id, { targetVersionId: target.id })).toMatchObject({ id: String(target.id), version: '1.0.1', description: 'Keep me', weight: 7, isEmpty: false })
    expect(await client.category.findUniqueOrThrow({ where: { id: trash.id } })).toMatchObject({ isDeleted: true })
    const second = await publishProjectVersion(target.id)
    expect(second.releaseHash).not.toBe(released.releaseHash)
    expect((await getProjectVersionIntegrity(target.id)).manifest?.contentHash).toBe((await getProjectVersionIntegrity(s.version.id)).manifest?.contentHash)
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
  it('detects direct body, hierarchy and snapshot tampering while preserving the publication name', async () => {
    const s = await seed()
    await publishProjectVersion(s.version.id)
    const released = await getProjectVersionIntegrity(s.version.id)
    await client.project.update({ where: { id: s.project.id }, data: { projectName: 'Changed display name' } })
    expect(await getProjectVersionIntegrity(s.version.id)).toMatchObject({ valid: true, manifest: released.manifest })
    for (const [model, id, field, original] of [
      ['noteContent', s.body.id, 'content', s.body.content],
      ['noteInfo', s.note.id, 'noteTitle', s.note.noteTitle],
      ['category', s.category.id, 'categoryName', s.category.categoryName],
    ] as const) {
      const update = client[model].update as unknown as (input: { where: { id: number }; data: Record<string, string> }) => Promise<unknown>
      await update({ where: { id }, data: { [field]: original + ' tampered' } })
      expect((await getProjectVersionIntegrity(s.version.id)).valid).toBe(false)
      await update({ where: { id }, data: { [field]: original } })
    }
    const version = await client.projectVersion.findUniqueOrThrow({ where: { id: s.version.id } })
    await client.projectVersion.update({ where: { id: s.version.id }, data: { releaseManifestJson: version.releaseManifestJson + ' ' } })
    expect((await getProjectVersionIntegrity(s.version.id)).valid).toBe(false)
  })
})
