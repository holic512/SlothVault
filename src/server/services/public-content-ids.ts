/**
 * @file public-content-ids.ts
 * @project SlothVault
 * @module Public Content Resolution
 * @description Resolves opaque public route identities and authoritative publication visibility.
 * @logic Validate external parameters once, constrain every ancestor, and pass internal integer keys to existing services.
 * @dependencies Prisma, public-content-id, HTTP errors, Next navigation
 * @index_tags public-id,routes,publication,permissions
 * @author holic512
 */
import 'server-only'
import { notFound } from 'next/navigation'
import { publicContentIdPattern } from '@/lib/public-content-id'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export const publishedVersionWhere = {
  isDeleted: false, status: 1, publishedAt: { not: null },
  releaseId: { not: null }, releaseHash: { not: null }, manifestVersion: 3,
} as const
export const publishedProjectWhere = {
  isDeleted: false, status: 1, versions: { some: publishedVersionWhere },
} as const

export function parsePublicContentId(value: string) {
  if (!publicContentIdPattern.test(value)) throw new HttpError('Content not found', 404, 404)
  return value
}

export async function resolvePublicProjectIds(params: { id: string; versionId?: string; noteId?: string }) {
  const id = parsePublicContentId(params.id)
  const versionPublicId = params.versionId === undefined ? undefined : parsePublicContentId(params.versionId)
  const notePublicId = params.noteId === undefined ? undefined : parsePublicContentId(params.noteId)
  const project = await prisma.project.findFirst({ where: { publicId: id, ...publishedProjectWhere }, select: { id: true } })
  if (!project) throw new HttpError('Project not found', 404, 404)
  if (versionPublicId === undefined) return { projectId: project.id, versionId: undefined, noteId: undefined }
  const version = await prisma.projectVersion.findFirst({ where: { publicId: versionPublicId, projectId: project.id, ...publishedVersionWhere }, select: { id: true } })
  if (!version) throw new HttpError('Version not found', 404, 404)
  if (notePublicId === undefined) return { projectId: project.id, versionId: version.id, noteId: undefined }
  const note = await prisma.noteInfo.findFirst({ where: { publicId: notePublicId, isDeleted: false, status: 1, category: { projectVersionId: version.id, isDeleted: false, status: 1 } }, select: { id: true } })
  if (!note) throw new HttpError('Note not found', 404, 404)
  return { projectId: project.id, versionId: version.id, noteId: note.id }
}

export async function resolvePublicArticleId(value: string) {
  const publicId = parsePublicContentId(value)
  const article = await prisma.article.findFirst({ where: { publicId, isDeleted: false, status: 1, publishedAt: { not: null } }, select: { id: true } })
  if (!article) throw new HttpError('Article not found', 404, 404)
  return article.id
}

export async function resolveProjectPageParams(params: Parameters<typeof resolvePublicProjectIds>[0]) {
  try { return await resolvePublicProjectIds(params) }
  catch (error) { if (error instanceof HttpError && error.status === 404) notFound(); throw error }
}
