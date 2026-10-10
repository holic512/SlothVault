import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import type { AccessViewer } from '@/lib/content-access'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  root: `/tmp/sv-preview-${process.pid}-${Date.now()}`,
  client: null as unknown as AppPrismaClient,
  viewer: { userId: 1, role: 'ADMIN' } as AccessViewer,
}))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/auth/viewer', () => ({ getPageViewer: async () => fixture.viewer }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`) },
  notFound: () => { throw new Error('not-found') },
}))

import { getPreviewVersion, getPreviewSidebar, getPreviewNote, getPreviewHome } from './project-preview'
import { getProjectNoteMetadata, getProjectVersions, listPublicProjects } from './public-projects'
import { authorizeManagedFile } from './file-access'

let projectId: number
let versionId: number
let categoryId: number
let noteId: number
let contentId: number

beforeEach(async () => {
  mkdirSync(fixture.root, { recursive: true })
  const path = `${fixture.root}/test.sqlite`
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name)).sort()) {
    db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  }
  db.close()
  fixture.client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) as unknown as AppPrismaClient
  fixture.viewer = { userId: 1, role: 'ADMIN' }
  const project = await fixture.client.project.create({ data: { weight: 0, status: 1, projectName: 'Unpublished project' } })
  const version = await fixture.client.projectVersion.create({ data: { weight: 0, status: 1, projectId: project.id, version: 'Draft' } })
  const category = await fixture.client.category.create({ data: { weight: 0, status: 1, projectVersionId: version.id, categoryName: 'Guide' } })
  const note = await fixture.client.noteInfo.create({ data: { weight: 0, status: 1, categoryId: category.id, noteTitle: 'Intro', tagsJson: '["API"]' } })
  const content = await fixture.client.noteContent.create({ data: { status: 1, noteInfoId: note.id, content: '# Saved', isPrimary: true } })
  projectId = project.id; versionId = version.id; categoryId = category.id; noteId = note.id; contentId = content.id
})
afterEach(async () => { await fixture.client.$disconnect(); rmSync(fixture.root, { recursive: true, force: true }) })

describe('administrator version preview', () => {
  it('reads a draft and updated saved data while public navigation still excludes it', async () => {
    expect(await listPublicProjects()).toEqual([])
    expect(await getProjectVersions(projectId)).toEqual([])
    await expect(getProjectNoteMetadata(projectId, versionId, noteId)).rejects.toMatchObject({ status: 404 })
    expect(await getPreviewSidebar(projectId, versionId)).toMatchObject([{ notes: [{ id: String(noteId) }] }])
    expect(await getPreviewNote(projectId, versionId, noteId)).toMatchObject({ content: '# Saved', tags: ['API'], publishedAt: null, releaseHash: null })
    await fixture.client.noteContent.update({ where: { id: contentId }, data: { content: '# Updated' } })
    expect((await getPreviewNote(projectId, versionId, noteId)).content).toBe('# Updated')
  })
  it.each([null, { userId: 2, role: 'USER' }])('rejects unauthorized viewers before querying version data: %s', async viewer => {
    fixture.viewer = viewer
    const query = vi.spyOn(fixture.client.projectVersion, 'findFirst')
    await expect(getPreviewVersion(projectId, versionId)).rejects.toThrow('redirect:/admin/auth/login')
    await expect(getPreviewNote(projectId, versionId, noteId)).rejects.toThrow('redirect:/admin/auth/login')
    expect(query).not.toHaveBeenCalled()
    query.mockRestore()
  })
  it('previews hidden parents and actual published fields, but rejects deleted parents', async () => {
    await fixture.client.project.update({ where: { id: projectId }, data: { status: 0 } })
    await fixture.client.projectVersion.update({ where: { id: versionId }, data: { status: 0, publishedAt: new Date(), releaseId: 'real-release', releaseHash: 'a'.repeat(64), manifestVersion: 2 } })
    expect(await getPreviewNote(projectId, versionId, noteId)).toMatchObject({ releaseId: 'real-release', releaseHash: 'a'.repeat(64) })
    await fixture.client.project.update({ where: { id: projectId }, data: { isDeleted: true } })
    await expect(getPreviewVersion(projectId, versionId)).rejects.toThrow('not-found')
  })
  it('rejects mismatched projects, versions, deleted notes and malformed identities', async () => {
    const other = await fixture.client.project.create({ data: { weight: 0, status: 1, projectName: 'Other' } })
    const draft = await fixture.client.projectVersion.create({ data: { weight: 0, status: 1, projectId, version: 'Other version' } })
    await expect(getPreviewVersion(other.id, versionId)).rejects.toThrow('not-found')
    await expect(getPreviewNote(projectId, draft.id, noteId)).rejects.toThrow('not-found')
    await expect(getPreviewVersion(NaN, versionId)).rejects.toThrow('not-found')
    await fixture.client.noteInfo.update({ where: { id: noteId }, data: { isDeleted: true } })
    await expect(getPreviewNote(projectId, versionId, noteId)).rejects.toThrow('not-found')
  })
  it.each(['category', 'note', 'body', 'missing', 'multiple'] as const)('excludes unreadable documents: %s', async kind => {
    if (kind === 'category') await fixture.client.category.update({ where: { id: categoryId }, data: { status: 0 } })
    if (kind === 'note') await fixture.client.noteInfo.update({ where: { id: noteId }, data: { status: 0 } })
    if (kind === 'body') await fixture.client.noteContent.update({ where: { id: contentId }, data: { status: 0 } })
    if (kind === 'missing') await fixture.client.noteContent.update({ where: { id: contentId }, data: { isPrimary: false } })
    if (kind === 'multiple') await fixture.client.noteContent.create({ data: { status: 1, noteInfoId: noteId, content: 'Second primary', isPrimary: true } })
    expect(await getPreviewSidebar(projectId, versionId)).toEqual([])
    await expect(getPreviewNote(projectId, versionId, noteId)).rejects.toThrow('not-found')
  })
  it('reads only the enabled homepage', async () => {
    expect(await getPreviewHome(projectId, versionId)).toBeNull()
    const home = await fixture.client.projectHome.create({ data: { projectId, content: '# Home' } })
    expect(await getPreviewHome(projectId, versionId)).toMatchObject({ content: '# Home' })
    await fixture.client.projectHome.update({ where: { id: home.id }, data: { status: 0 } })
    expect(await getPreviewHome(projectId, versionId)).toBeNull()
  })
  it.each(['png', 'zip'])('authorizes contextual draft resources only for administrators: %s', async extension => {
    const filePath = `uploads/note/test.${extension}`
    const file = await fixture.client.fileManagement.create({ data: { originalName: `test.${extension}`, fileName: `test.${extension}`, filePath, fileSize: 1n, businessType: extension === 'png' ? 'NoteImage' : 'NoteAttachment' } })
    await fixture.client.fileReference.create({ data: { fileId: file.id, sourceType: 'NOTE_CONTENT', sourceId: contentId, projectId, usage: extension === 'png' ? 'READ_MEDIA' : 'DOWNLOAD' } })
    await fixture.client.project.update({ where: { id: projectId }, data: { status: 0 } })
    await expect(authorizeManagedFile(filePath, fixture.viewer, { projectId })).resolves.toBeUndefined()
    for (const viewer of [null, { userId: 2, role: 'USER' }]) {
      await expect(authorizeManagedFile(filePath, viewer, { projectId })).rejects.toMatchObject({ status: 404 })
    }
    await expect(authorizeManagedFile(filePath, fixture.viewer, { projectId: projectId + 100 })).rejects.toMatchObject({ status: 403 })
    await fixture.client.noteContent.update({ where: { id: contentId }, data: { isDeleted: true } })
    await expect(authorizeManagedFile(filePath, fixture.viewer, { projectId })).rejects.toMatchObject({ status: 404 })
  })
})
