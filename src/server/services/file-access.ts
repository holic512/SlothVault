/**
 * @file file-access.ts
 * @project SlothVault
 * @module Managed File Authorization
 * @description Authorizes legacy and contextual upload URLs using live content references and independent project capabilities.
 * @logic Validate live project references for administrator previews, reject orphaned or hidden public references, allow any authorized shared use, validate explicit project context, and keep contract attachments on their dedicated routes.
 * @dependencies Prisma file/content models, content-access, auth roles, lib/managed-files
 * @index_tags files,authorization,shared-attachments,uploads,read,download
 * @author holic512
 */
import 'server-only'
import type { AccessViewer } from '@/lib/content-access'
import { isInlineImagePath, managedUploadPath } from '@/lib/managed-file-paths'
import { CONFIG_KEYS } from './system-config'
import { isAdminRole } from '@/server/auth/roles'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { resolveArticleAccess, resolveProjectAccess } from './content-access'

const visibleProject = { isDeleted: false, status: 1 } as const
const visibleVersion = { isDeleted: false, status: 1, publishedAt: { not: null }, releaseId: { not: null }, releaseHash: { not: null }, manifestVersion: 3, project: visibleProject } as const
type Reference = { sourceType: string; sourceId: number; projectId: number | null; usage: string }

async function liveReference(reference: Reference, filePath: string, administrator = false): Promise<{ projectId: number | null; publicRead: boolean; articleId?: number } | null> {
  switch (reference.sourceType) {
    case 'NOTE_CONTENT': {
      const item = await prisma.noteContent.findFirst({ where: {
        id: reference.sourceId, isDeleted: false, status: 1, isPrimary: true,
        noteInfo: { isDeleted: false, status: 1, category: { isDeleted: false, status: 1, projectVersion: administrator ? { isDeleted: false, project: { isDeleted: false } } : visibleVersion } },
      }, select: { noteInfo: { select: { category: { select: { projectVersion: { select: { projectId: true } } } } } } } })
      const projectId = item?.noteInfo.category.projectVersion.projectId
      return projectId && projectId === reference.projectId ? { projectId, publicRead: false } : null
    }
    case 'PROJECT_HOME': {
      const item = await prisma.projectHome.findFirst({ where: { id: reference.sourceId, status: 1, isDeleted: false, project: administrator ? { isDeleted: false } : visibleProject }, select: { projectId: true } })
      return item && item.projectId === reference.projectId ? { projectId: item.projectId, publicRead: true } : null
    }
    case 'PROJECT_MENU': {
      const item = await prisma.projectMenu.findFirst({ where: {
        id: reference.sourceId, status: 1, isDeleted: false, project: visibleProject,
        OR: [{ parentId: null }, { parent: { status: 1, isDeleted: false, parentId: null } }],
      }, select: { projectId: true } })
      return item && item.projectId === reference.projectId ? { projectId: item.projectId, publicRead: false } : null
    }
    case 'ARTICLE': {
      const item = await prisma.article.findFirst({ where: { id: reference.sourceId, status: 1, isDeleted: false, publishedAt: { not: null } }, select: { id: true, cover: true } })
      return item && reference.projectId === null ? { projectId: null, articleId: item.id, publicRead: reference.usage === 'READ_MEDIA' && managedUploadPath(item.cover ?? undefined) === filePath } : null
    }
    case 'SYSTEM_HOMEPAGE': {
      const item = await prisma.systemHomepage.findFirst({ where: { status: 1, isDeleted: false }, orderBy: { id: 'desc' }, select: { id: true } })
      return item?.id === reference.sourceId && reference.projectId === null ? { projectId: null, publicRead: true } : null
    }
    case 'PROJECT_AVATAR': {
      const item = await prisma.project.findFirst({ where: { id: reference.sourceId, ...(administrator ? { isDeleted: false } : visibleProject) }, select: { id: true, avatar: true } })
      return item && item.id === reference.projectId && managedUploadPath(item.avatar ?? undefined) === filePath ? { projectId: item.id, publicRead: true } : null
    }
    case 'USER_AVATAR': {
      const item = await prisma.user.findFirst({ where: { id: reference.sourceId, status: 1 }, select: { avatar: true } })
      return item && reference.projectId === null && managedUploadPath(item.avatar ?? undefined) === filePath ? { projectId: null, publicRead: true } : null
    }
    case 'SYSTEM_CONFIG': {
      const item = await prisma.systemConfig.findUnique({ where: { id: reference.sourceId }, select: { configKey: true, configValue: true } })
      return item && reference.projectId === null && ([CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH, CONFIG_KEYS.SYSTEM_FAVICON_FILE_PATH] as string[]).includes(item.configKey) && managedUploadPath(`/${item.configValue}`) === filePath ? { projectId: null, publicRead: true } : null
    }
    default: return null
  }
}

export async function authorizeManagedFile(
  filePath: string,
  viewer: AccessViewer,
  options: { projectId?: number; download?: boolean } = {},
) {
  const files = await prisma.fileManagement.findMany({ where: { filePath, status: 1 }, include: { references: true } })
  if (!files.length) throw new HttpError('File not found', 404, 404)
  if (files.some((file) => file.businessType === 'ContractAttachment')) throw new HttpError('Access denied', 403, 403)
  const inlineImage = isInlineImagePath(filePath)
  if (viewer && isAdminRole(viewer.role) && options.projectId === undefined) return
  const policies = new Map<number, Awaited<ReturnType<typeof resolveProjectAccess>>>()
  let foundLiveReference = false
  let reason = viewer ? 'MEMBERSHIP_REQUIRED' : 'LOGIN_REQUIRED'
  for (const reference of files.flatMap((file) => file.references)) {
    if (options.projectId !== undefined && reference.projectId !== options.projectId) continue
    const administrator = Boolean(viewer && isAdminRole(viewer.role))
    const context = await liveReference(reference, filePath, administrator)
    if (!context) continue
    foundLiveReference = true
    if (administrator) return
    const download = Boolean(options.download || !inlineImage || reference.usage !== 'READ_MEDIA')
    if (context.projectId !== null) {
      if (context.publicRead && !download) return
      let access = policies.get(context.projectId)
      if (!access) { access = await resolveProjectAccess(context.projectId, viewer); policies.set(context.projectId, access) }
      if (download ? access.canDownload : access.canRead) return
      const deniedReason = download ? access.downloadReason : access.readReason
      if (deniedReason === 'DOWNLOAD_DISABLED') reason = deniedReason
    } else if (context.publicRead || (context.articleId && await resolveArticleAccess(context.articleId, viewer))) return
  }
  if (!foundLiveReference) {
    const hasReference = files.some(file => file.references.some(reference => options.projectId === undefined || reference.projectId === options.projectId))
    throw new HttpError(hasReference ? 'File not found' : 'Access denied', hasReference ? 404 : 403, hasReference ? 404 : 403, { reason: 'FILE_REFERENCE_REQUIRED' })
  }
  throw new HttpError('Access denied', reason === 'LOGIN_REQUIRED' ? 401 : 403, reason === 'LOGIN_REQUIRED' ? 401 : 403, { reason })
}
