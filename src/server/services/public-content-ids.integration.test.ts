import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessViewer } from '@/lib/content-access'
import type { AppPrismaClient } from '@/server/database/client'
import { personalSecurityDatabase } from '@/test/personal-security-database'

const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient, viewer: null as AccessViewer }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/auth/viewer', () => ({ getRequestViewer: () => fixture.viewer, getPageViewer: () => fixture.viewer }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/services/maintenance-lock', () => ({ acquireMaintenanceLock: async () => () => undefined }))

import { resolvePublicArticleId, resolvePublicProjectIds } from './public-content-ids'
import { presentContentLinks } from './public-content-links'
import { getProjectMenu, getProjectNote, getProjectSidebar, getProjectVersions, getPublicProject, findPublicProjectHome } from './public-projects'
import { cloneProjectVersion, getProjectVersionManifest, publishProjectVersion } from './project-version-release'
import { getPreviewNote } from './project-preview'
import { GET as getProject } from '@/app/api/project/[id]/route'
import { GET as getHome } from '@/app/api/project/[id]/home/route'
import { GET as getMenu } from '@/app/api/project/[id]/menu/route'
import { GET as getVersions } from '@/app/api/project/[id]/versions/route'
import { GET as getSidebar } from '@/app/api/project/[id]/v/[versionId]/sidebar/route'
import { GET as getNote, HEAD as headNote } from '@/app/api/project/[id]/v/[versionId]/note/[noteId]/route'
import { GET as getManifest } from '@/app/api/project/[id]/v/[versionId]/manifest/route'
import { GET as getEvidence } from '@/app/api/project/[id]/v/[versionId]/evidence/route'
import { POST as verifyAccess } from '@/app/api/project/[id]/verify-access/route'

let database: ReturnType<typeof personalSecurityDatabase>
beforeEach(() => { database = personalSecurityDatabase(); fixture.client = database.client; fixture.viewer = null })
afterEach(async () => database.close())

async function seed() {
  const project = await fixture.client.project.create({ data: { projectName: 'Public identities', weight: 0, status: 1, legacyUrlId: 501 } })
  const version = await fixture.client.projectVersion.create({ data: { projectId: project.id, version: '1.0.0', weight: 0, status: 0, legacyUrlId: 502 } })
  const category = await fixture.client.category.create({ data: { projectVersionId: version.id, categoryName: 'Guide', weight: 0, status: 1 } })
  const note = await fixture.client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Guide', weight: 0, status: 1, legacyUrlId: 503 } })
  const oldUrl = '/project/501/v/502/docs/503?mode=read#intro'
  const content = `# Guide\n\n[Read](${oldUrl})\n\n<aside><a href="${oldUrl}">HTML</a></aside>\n\n\`${oldUrl}\`\n\n\`\`\`md\n[Code](${oldUrl})\n\`\`\`\n\n${oldUrl}\n\n[External](https://example.invalid${oldUrl})`
  const body = await fixture.client.noteContent.create({ data: { noteInfoId: note.id, content, status: 1, isPrimary: true } })
  const release = await publishProjectVersion(version.id)
  const article = await fixture.client.article.create({ data: { title: 'Article', content: '# Article', status: 1, publishedAt: new Date(), legacyUrlId: 504 } })
  await fixture.client.projectHome.create({ data: { projectId: project.id, content: `[Read](${oldUrl})` } })
  await fixture.client.projectMenu.create({ data: { projectId: project.id, label: 'Read', url: oldUrl } })
  return { project, version, note, body, article, content, release, oldUrl }
}

describe('persistent public content identities', () => {
  it('resolves only UUIDs and enforces project/version/note ancestry and publication', async () => {
    const s = await seed()
    const params = { id: s.project.publicId, versionId: s.version.publicId, noteId: s.note.publicId }
    expect(await resolvePublicProjectIds(params)).toEqual({ projectId: s.project.id, versionId: s.version.id, noteId: s.note.id })
    expect(await resolvePublicArticleId(s.article.publicId)).toBe(s.article.id)
    for (const bad of [{ ...params, id: String(s.project.id) }, { ...params, versionId: String(s.version.id) }, { ...params, noteId: String(s.note.id) }, { ...params, id: randomUUID() }]) {
      await expect(resolvePublicProjectIds(bad)).rejects.toMatchObject({ status: 404 })
    }
    await expect(resolvePublicArticleId(String(s.article.id))).rejects.toMatchObject({ status: 404 })
    const other = await fixture.client.project.create({ data: { projectName: 'Draft', weight: 0, status: 1 } })
    await expect(resolvePublicProjectIds({ id: other.publicId })).rejects.toMatchObject({ status: 404 })
    const sibling = await fixture.client.projectVersion.create({ data: { projectId: s.project.id, version: 'other', weight: 0, status: 1, publishedAt: new Date(), releaseId: randomUUID(), releaseHash: 'a'.repeat(64), manifestVersion: 3 } })
    await expect(resolvePublicProjectIds({ ...params, versionId: sibling.publicId })).rejects.toMatchObject({ status: 404 })
    await fixture.client.project.update({ where: { id: s.project.id }, data: { status: 0 } })
    await expect(resolvePublicProjectIds(params)).rejects.toMatchObject({ status: 404 })
  })

  it('rejects numeric and mixed identifiers on every public API and serves canonical UUIDs', async () => {
    const s = await seed()
    const params = { id: s.project.publicId, versionId: s.version.publicId, noteId: s.note.publicId }
    for (const handler of [getProject, getHome, getMenu, getVersions, getSidebar, getNote, headNote, getManifest, getEvidence, verifyAccess]) {
      const request = new NextRequest('http://localhost/api/project/test', { method: handler === verifyAccess ? 'POST' : 'GET' })
      expect((await handler(request, { params: Promise.resolve(params) })).status).toBe(200)
      for (const bad of [{ ...params, id: String(s.project.id) }, { ...params, versionId: String(s.version.id) }, { ...params, noteId: String(s.note.id) }]) {
        expect((await handler(request, { params: Promise.resolve(bad) })).status).toBe(404)
      }
    }
  })

  it('returns opaque resource identities and presentation keys without internal row identifiers', async () => {
    const s = await seed()
    expect((await getPublicProject(s.project.id)).id).toBe(s.project.publicId)
    expect((await getProjectVersions(s.project.id))[0].id).toBe(s.version.publicId)
    const sidebar = await getProjectSidebar(s.project.id, s.version.id)
    expect(sidebar[0]).toHaveProperty('key')
    expect(sidebar[0]).not.toHaveProperty('id')
    expect(sidebar[0].notes[0].id).toBe(s.note.publicId)
    expect((await getProjectMenu(s.project.id))[0]).not.toHaveProperty('id')
    await fixture.client.projectMenu.create({ data: { projectId: s.project.id, label: 'Relative', url: '/v/502/docs/503' } })
    expect((await getProjectMenu(s.project.id)).find(menu => menu.label === 'Relative')?.url).toBe(`/project/${s.project.publicId}/v/${s.version.publicId}/docs/${s.note.publicId}`)
    expect(await findPublicProjectHome(s.project.id)).not.toHaveProperty('id')
    const body = await getProjectNote(s.project.id, s.version.id, s.note.id)
    expect(body.noteId).toBe(s.note.publicId)
    expect(body).not.toHaveProperty('id')
  })

  it('converts only link targets and preserves release bytes, source text, code and foreign URLs', async () => {
    const s = await seed()
    const canonical = `/project/${s.project.publicId}/v/${s.version.publicId}/docs/${s.note.publicId}?mode=read#intro`
    const presented = await presentContentLinks(s.content)
    expect(presented).toContain(`[Read](${canonical})`)
    expect(presented).toContain(`href="${canonical}"`)
    expect(presented).toContain(`\`${s.oldUrl}\``)
    expect(presented).toContain(`[Code](${s.oldUrl})`)
    expect(presented).toContain(`https://example.invalid${s.oldUrl}`)
    expect(presented).toContain(`\n\n${s.oldUrl}\n`)
    expect(await presentContentLinks('[Article](/articles/504#title)')).toBe(`[Article](/articles/${s.article.publicId}#title)`)
    expect((await fixture.client.noteContent.findUniqueOrThrow({ where: { id: s.body.id } })).content).toBe(s.content)
    expect((await getProjectVersionManifest(s.version.id, { publicProjectId: s.project.id })).releaseHash).toBe(s.release.releaseHash)
  })

  it('keeps identities on edit, gives clones new identities and resolves them in administrator preview', async () => {
    const s = await seed()
    await fixture.client.project.update({ where: { id: s.project.id }, data: { projectName: 'Renamed' } })
    expect((await fixture.client.project.findUniqueOrThrow({ where: { id: s.project.id } })).publicId).toBe(s.project.publicId)
    const cloned = await cloneProjectVersion(s.version.id, { version: '2.0.0' })
    const version = await fixture.client.projectVersion.findUniqueOrThrow({ where: { id: Number(cloned.id) } })
    const note = await fixture.client.noteInfo.findFirstOrThrow({ where: { category: { projectVersionId: version.id } } })
    expect(version.publicId).not.toBe(s.version.publicId)
    expect(note.publicId).not.toBe(s.note.publicId)
    expect(version.legacyUrlId).toBeNull()
    const content = await fixture.client.noteContent.findFirstOrThrow({ where: { noteInfoId: note.id } })
    expect(content.content).toContain(`/project/${s.project.publicId}/v/${version.publicId}/docs/${note.publicId}`)
    fixture.viewer = { userId: 1, role: 'ADMIN' }
    expect((await getPreviewNote(s.project.id, version.id, note.id)).content).toContain(`/preview/project/${s.project.id}/v/${version.id}/docs/${note.id}`)
    const previewLink = `[Draft](/preview/project/${s.project.id}/v/${version.id}/docs/${note.id})`
    expect(await presentContentLinks(previewLink, { preview: true, projectId: s.project.id, versionId: version.id })).toBe(previewLink)
    await publishProjectVersion(version.id)
    expect(await presentContentLinks(previewLink)).toBe(`[Draft](/project/${s.project.publicId}/v/${version.publicId}/docs/${note.publicId})`)
  })
})
