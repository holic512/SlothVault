/**
 * @file project-preview.ts
 * @project SlothVault
 * @module Administrator Version Preview
 * @description Reads saved project versions for authenticated administrators without public cache or publication requirements.
 * @logic Authorize before querying, constrain parent identities, and expose only enabled documents with one primary body.
 * @dependencies Prisma, session viewer, auth roles, Next navigation, content access
 * @index_tags preview,admin,project,version,permissions
 * @author holic512
 */
import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { getPageViewer } from '@/server/auth/viewer'
import { isAdminRole } from '@/server/auth/roles'
import { prisma } from '@/server/prisma'
import { readNoteTags } from '@/lib/note-tags'
import { evaluateProjectAccess } from '@/lib/content-access'
import { projectAccessInclude, projectPolicyDto } from './content-access'

export async function requirePreviewAdmin() {
  const viewer = await getPageViewer()
  if (!viewer || !isAdminRole(viewer.role)) redirect('/admin/auth/login')
  return viewer
}

export async function getPreviewVersion(projectId: number, versionId: number) {
  await requirePreviewAdmin()
  if (![projectId, versionId].every(id => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)) notFound()
  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId, isDeleted: false, project: { isDeleted: false } },
    include: { project: { include: projectAccessInclude } },
  })
  if (!version) notFound()
  return version
}

export async function getPreviewSidebar(projectId: number, versionId: number) {
  await getPreviewVersion(projectId, versionId)
  const categories = await prisma.category.findMany({
    where: { projectVersionId: versionId, isDeleted: false, status: 1 }, orderBy: { weight: 'desc' },
    include: { noteInfos: {
      where: { isDeleted: false, status: 1 }, orderBy: { weight: 'desc' },
      select: { id: true, noteTitle: true, weight: true, contents: {
        where: { isPrimary: true, isDeleted: false, status: 1 }, select: { id: true }, take: 2,
      } },
    } },
  })
  return categories.map(category => ({
    id: String(category.id), categoryName: category.categoryName, weight: category.weight,
    notes: category.noteInfos.filter(note => note.contents.length === 1).map(note => ({
      id: String(note.id), noteTitle: note.noteTitle, weight: note.weight,
    })),
  })).filter(category => category.notes.length > 0)
}

export async function getPreviewNote(projectId: number, versionId: number, noteId: number) {
  await getPreviewVersion(projectId, versionId)
  if (!Number.isSafeInteger(noteId) || noteId < 1 || noteId > 2_147_483_647) notFound()
  const note = await prisma.noteInfo.findFirst({
    where: { id: noteId, isDeleted: false, status: 1, category: { projectVersionId: versionId, isDeleted: false, status: 1 } },
    include: { contents: { where: { isPrimary: true, isDeleted: false, status: 1 }, take: 2 } },
  })
  if (!note || note.contents.length !== 1) notFound()
  const content = note.contents[0]
  return {
    id: String(content.id), noteId: String(note.id), noteTitle: note.noteTitle, tags: readNoteTags(note.tagsJson),
    content: content.content, versionNote: content.versionNote, updatedAt: content.updatedAt.toISOString(),

  }
}

export async function getPreviewHome(projectId: number, versionId: number) {
  await getPreviewVersion(projectId, versionId)
  const home = await prisma.projectHome.findFirst({ where: { projectId, status: 1, isDeleted: false } })
  return home ? { id: String(home.id), projectId: String(projectId), content: home.content, updatedAt: home.updatedAt.toISOString() } : null
}

export function previewAccess(project: Parameters<typeof projectPolicyDto>[0]) {
  return evaluateProjectAccess(projectPolicyDto(project), true, [], true)
}
