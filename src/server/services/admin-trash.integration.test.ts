import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '../../../generated/prisma-sqlite/client'

type SqliteTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'>

const mocks = vi.hoisted(() => ({
  client: undefined as PrismaClient | undefined,
  invalidate: vi.fn(),
}))

vi.mock('@/server/prisma', () => ({ get prisma() { return mocks.client } }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: mocks.invalidate }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: mocks.invalidate }))
vi.mock('@/server/services/project-version-release', () => ({
  executeVersionWrite: async (operation: (transaction: SqliteTransaction) => Promise<unknown>) => mocks.client!.$transaction(operation),
  lockDraftProjectVersions: async (transaction: SqliteTransaction, ids: number[]) => {
    for (const id of ids) {
      const result = await transaction.projectVersion.updateMany({
        where: { id, isDeleted: false, publishedAt: null },
        data: { documentRevision: { increment: 1 } },
      })
      if (result.count !== 1) throw new Error('Frozen or deleted version')
    }
  },
}))

import { deleteTrashItem, deleteVersionBatch, restoreTrashItem } from './admin-trash'
import { getTrashPreview, listTrashArticles, listTrashChildren, listTrashProjects } from './admin-trash-read'
import { createOrRestoreProjectHome } from './admin-content'

let directory: string | undefined

afterEach(async () => {
  if (mocks.client) await mocks.client.$disconnect()
  mocks.client = undefined
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
  mocks.invalidate.mockClear()
})

async function database() {
  directory = mkdtempSync(join(tmpdir(), 'slothvault-trash-'))
  const databasePath = join(directory, 'trash.db')
  const bootstrap = new Database(databasePath)
  const migrationsPath = resolve(process.cwd(), 'prisma/providers/sqlite/migrations')
  for (const migration of readdirSync(migrationsPath).filter((entry) => /^\d/.test(entry)).sort()) {
    bootstrap.exec(readFileSync(join(migrationsPath, migration, 'migration.sql'), 'utf8'))
  }
  bootstrap.close()
  mocks.client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file://${databasePath}` }) })
  return mocks.client
}

describe('SQLite content trash round trip', () => {
  it('cascades drafts, preserves frozen releases, previews only on demand, and restores ancestors without siblings', async () => {
    const client = await database()
    const project = await client.project.create({ data: { projectName: 'Project', weight: 0, status: 1 } })
    const released = await client.projectVersion.create({ data: { projectId: project.id, version: 'stable', weight: 0, status: 1, publishedAt: new Date(), releaseId: 'stable-release', releaseHash: 'stable-hash', manifestVersion: 1 } })
    const releasedCategory = await client.category.create({ data: { projectVersionId: released.id, categoryName: 'Published', weight: 0, status: 1 } })
    const releasedNote = await client.noteInfo.create({ data: { categoryId: releasedCategory.id, noteTitle: 'Published note', weight: 0, status: 1 } })
    const releasedContent = await client.noteContent.create({ data: { noteInfoId: releasedNote.id, content: '# Frozen body', status: 1, isPrimary: true } })
    const draft = await client.projectVersion.create({ data: { projectId: project.id, version: 'draft', weight: 0, status: 0 } })
    const category = await client.category.create({ data: { projectVersionId: draft.id, categoryName: 'Guides', weight: 0, status: 1 } })
    const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'How-to', weight: 0, status: 1 } })
    const current = await client.noteContent.create({ data: { noteInfoId: note.id, content: '# Version one', status: 1, isPrimary: true } })
    const older = await client.noteContent.create({ data: { noteInfoId: note.id, content: '# Previously deleted', status: 1, isDeleted: true } })
    const menu = await client.projectMenu.create({ data: { projectId: project.id, label: 'Docs', status: 1 } })
    const submenu = await client.projectMenu.create({ data: { projectId: project.id, parentId: menu.id, label: 'Guide', status: 1 } })
    const home = await client.projectHome.create({ data: { projectId: project.id, content: '# Homepage', status: 1 } })

    await deleteTrashItem('project', project.id)

    expect(await client.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ isDeleted: true, status: 0, deletedAt: expect.any(Date) })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: released.id } })).toMatchObject({ isDeleted: false, deletedAt: null, publishedAt: expect.any(Date), releaseId: 'stable-release', releaseHash: 'stable-hash', manifestVersion: 1 })
    expect(await client.category.findUniqueOrThrow({ where: { id: releasedCategory.id } })).toMatchObject({ isDeleted: false, deletedAt: null })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: releasedContent.id } })).toMatchObject({ isDeleted: false, content: '# Frozen body', isPrimary: true })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ isDeleted: true, deletedAt: expect.any(Date) })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: older.id } })).toMatchObject({ isDeleted: true, deletedAt: null })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ isDeleted: true, isPrimary: false })
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: submenu.id } })).toMatchObject({ isDeleted: true })
    expect(await client.projectHome.findUniqueOrThrow({ where: { id: home.id } })).toMatchObject({ isDeleted: true })

    const roots = await listTrashProjects(1, 20, '')
    expect(roots.list).toHaveLength(1)
    const children = await listTrashChildren('project', project.id)
    expect(children.find((item) => item.id === String(released.id))).toMatchObject({ frozen: true, hiddenByParent: true, isDeleted: false })
    expect(children.find((item) => item.kind === 'home' && item.id === String(home.id))).toMatchObject({ kind: 'home', isDeleted: true })
    expect(await getTrashPreview('content', current.id)).toMatchObject({ content: '# Version one' })
    expect(await getTrashPreview('content', releasedContent.id)).toMatchObject({ content: '# Frozen body' })
    expect(await getTrashPreview('home', home.id)).toMatchObject({ content: '# Homepage' })
    await expect(deleteTrashItem('category', releasedCategory.id)).rejects.toMatchObject({ status: 409 })

    await restoreTrashItem('content', current.id)
    expect(await client.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ isDeleted: false, status: 1 })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ isDeleted: false, status: 0 })
    expect(await client.category.findUniqueOrThrow({ where: { id: category.id } })).toMatchObject({ isDeleted: false })
    expect(await client.noteInfo.findUniqueOrThrow({ where: { id: note.id } })).toMatchObject({ isDeleted: false })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ isDeleted: false, isPrimary: true })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: older.id } })).toMatchObject({ isDeleted: true })
    expect(await client.projectHome.findUniqueOrThrow({ where: { id: home.id } })).toMatchObject({ isDeleted: true })

    await expect(restoreTrashItem('category', releasedCategory.id)).rejects.toMatchObject({ status: 409 })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: released.id } })).toMatchObject({ isDeleted: false, publishedAt: expect.any(Date), releaseHash: 'stable-hash' })
  })

  it('restores articles as drafts and leaves legacy deletion time unknown', async () => {
    const client = await database()
    const oldArticle = await client.article.create({ data: { title: 'Legacy', content: '# Legacy', status: 0, isDeleted: true } })
    const recent = await client.article.create({ data: { title: 'Recent', content: '# Recent', status: 1, publishedAt: new Date() } })
    await deleteTrashItem('article', recent.id)

    const list = await listTrashArticles(1, 20, '')
    expect(list.list.find((item) => item.id === String(oldArticle.id))?.deletedAt).toBeNull()
    expect(list.list.find((item) => item.id === String(recent.id))?.deletedAt).toBeInstanceOf(Date)
    expect(await getTrashPreview('article', recent.id)).toMatchObject({ content: '# Recent' })

    await restoreTrashItem('article', recent.id)
    expect(await client.article.findUniqueOrThrow({ where: { id: recent.id } })).toMatchObject({ isDeleted: false, deletedAt: null, status: 0, publishedAt: expect.any(Date) })
  })

  it('restores a project alone, then a menu child with its parent while leaving other branches deleted', async () => {
    const client = await database()
    const project = await client.project.create({ data: { projectName: 'Menu project', weight: 0, status: 1 } })
    const parent = await client.projectMenu.create({ data: { projectId: project.id, label: 'Root' } })
    const child = await client.projectMenu.create({ data: { projectId: project.id, parentId: parent.id, label: 'Nested' } })
    const homepage = await client.projectHome.create({ data: { projectId: project.id, content: '# Home' } })

    await deleteTrashItem('project', project.id)
    await restoreTrashItem('project', project.id)
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ isDeleted: true })
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ isDeleted: true })
    expect((await listTrashProjects(1, 20, '')).list).toMatchObject([{ kind: 'project', isDeleted: false }])
    await expect(createOrRestoreProjectHome(project.id, { content: '# Unwanted overwrite' })).rejects.toMatchObject({ status: 409 })
    expect(await client.projectHome.findUniqueOrThrow({ where: { id: homepage.id } })).toMatchObject({ content: '# Home', isDeleted: true })

    await restoreTrashItem('menu', child.id)
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ isDeleted: false })
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ isDeleted: false })
    expect(await client.projectHome.findUniqueOrThrow({ where: { id: homepage.id } })).toMatchObject({ isDeleted: true })
  })

  it('cascades batch draft deletion atomically and restores only the chosen version', async () => {
    const client = await database()
    const project = await client.project.create({ data: { projectName: 'Batch project', weight: 0, status: 1 } })
    const first = await client.projectVersion.create({ data: { projectId: project.id, version: 'first', weight: 0, status: 0 } })
    const second = await client.projectVersion.create({ data: { projectId: project.id, version: 'second', weight: 0, status: 0 } })
    const category = await client.category.create({ data: { projectVersionId: first.id, categoryName: 'Category', weight: 0, status: 1 } })
    const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Note', weight: 0, status: 1 } })
    const content = await client.noteContent.create({ data: { noteInfoId: note.id, content: 'Body', isPrimary: true, status: 1 } })

    expect(await deleteVersionBatch([first.id, second.id])).toEqual({ count: 2 })
    const deletedFirst = await client.projectVersion.findUniqueOrThrow({ where: { id: first.id } })
    expect(deletedFirst).toMatchObject({ isDeleted: true, deletedAt: expect.any(Date), status: 0 })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ isDeleted: true, deletedAt: deletedFirst.deletedAt })
    expect(await client.category.findUniqueOrThrow({ where: { id: category.id } })).toMatchObject({ isDeleted: true, deletedAt: deletedFirst.deletedAt })
    expect(await client.noteInfo.findUniqueOrThrow({ where: { id: note.id } })).toMatchObject({ isDeleted: true, deletedAt: deletedFirst.deletedAt })
    expect(await client.noteContent.findUniqueOrThrow({ where: { id: content.id } })).toMatchObject({ isDeleted: true, deletedAt: deletedFirst.deletedAt, isPrimary: false })

    await restoreTrashItem('version', first.id)
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ isDeleted: false, deletedAt: null, status: 0 })
    expect(await client.category.findUniqueOrThrow({ where: { id: category.id } })).toMatchObject({ isDeleted: true })
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ isDeleted: true })

    await expect(deleteVersionBatch([first.id, second.id])).rejects.toThrow()
    expect(await client.projectVersion.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ isDeleted: false })
  })

  it('cascades menu deletion while retaining a previously deleted child timestamp', async () => {
    const client = await database()
    const project = await client.project.create({ data: { projectName: 'Menu', weight: 0, status: 1 } })
    const parent = await client.projectMenu.create({ data: { projectId: project.id, label: 'Parent' } })
    const child = await client.projectMenu.create({ data: { projectId: project.id, parentId: parent.id, label: 'Child' } })
    const previouslyDeleted = await client.projectMenu.create({ data: { projectId: project.id, parentId: parent.id, label: 'Older', isDeleted: true } })

    await deleteTrashItem('menu', parent.id)
    const deletedParent = await client.projectMenu.findUniqueOrThrow({ where: { id: parent.id } })
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ isDeleted: true, deletedAt: deletedParent.deletedAt })
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: previouslyDeleted.id } })).toMatchObject({ isDeleted: true, deletedAt: null })

    await restoreTrashItem('menu', parent.id)
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ isDeleted: true })
    expect((await listTrashChildren('project', project.id)).find((item) => item.id === String(parent.id))).toMatchObject({ isDeleted: false, hasChildren: true })
    expect((await listTrashChildren('menu', parent.id)).map((item) => item.id)).toEqual([String(child.id), String(previouslyDeleted.id)])
  })

  it('previews an active legacy submenu inherited from a deleted parent', async () => {
    const client = await database()
    const project = await client.project.create({ data: { projectName: 'Legacy menu', weight: 0, status: 1 } })
    const parent = await client.projectMenu.create({ data: { projectId: project.id, label: 'Parent', isDeleted: true } })
    const child = await client.projectMenu.create({ data: { projectId: project.id, parentId: parent.id, label: 'Child', url: '/guide' } })

    expect((await listTrashChildren('menu', parent.id))[0]).toMatchObject({ id: String(child.id), hiddenByParent: true, isDeleted: false })
    expect(await getTrashPreview('menu', child.id)).toMatchObject({ content: '/guide', isDeleted: false })
    await restoreTrashItem('menu', child.id)
    expect(await client.projectMenu.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ isDeleted: false })
  })
})
