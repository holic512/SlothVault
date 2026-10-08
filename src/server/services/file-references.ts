/**
 * @file file-references.ts
 * @project SlothVault
 * @module Managed File Reference Index
 * @description Maintains authoritative file-to-content associations for protected uploads and shared attachments.
 * @logic Parse committed content inside its transaction, replace only that source's references, and backfill historical content without modifying signed bytes.
 * @dependencies Prisma file/content models, lib/managed-files
 * @index_tags files,references,authorization,backfill,markdown,transaction
 * @author holic512
 */
import 'server-only'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { extractManagedFiles, managedUploadPath, type FileSourceType, type ManagedFileLink } from '@/lib/managed-files'
import { CONFIG_KEYS } from './system-config'

type Reader = Prisma.TransactionClient

export async function indexFileWrite<T extends { id: number }>(reader: Reader, sourceType: FileSourceType, write: Promise<T>) {
  const record = await write
  await syncFileReferences(reader, sourceType, record.id)
  return record
}

export async function syncFileReferences(reader: Reader, sourceType: FileSourceType, sourceId: number) {
  let content = ''
  let projectId: number | null = null
  let menuLinks: ManagedFileLink[] | undefined
  const mediaLinks: ManagedFileLink[] = []
  const addMedia = (url: string | null | undefined) => {
    const filePath = managedUploadPath(url ?? undefined)
    if (filePath) mediaLinks.push({ filePath, usage: 'READ_MEDIA' })
  }
  switch (sourceType) {
    case 'NOTE_CONTENT': {
      const item = await reader.noteContent.findUnique({ where: { id: sourceId }, select: { content: true, noteInfo: { select: { category: { select: { projectVersion: { select: { projectId: true } } } } } } } })
      if (item) { content = item.content; projectId = item.noteInfo.category.projectVersion.projectId }
      break
    }
    case 'PROJECT_HOME': {
      const item = await reader.projectHome.findUnique({ where: { id: sourceId }, select: { content: true, projectId: true } })
      if (item) { content = item.content; projectId = item.projectId }
      break
    }
    case 'PROJECT_MENU': {
      const item = await reader.projectMenu.findUnique({ where: { id: sourceId }, select: { url: true, projectId: true } })
      if (item) {
        projectId = item.projectId
        const filePath = managedUploadPath(item.url ?? undefined)
        menuLinks = filePath ? [{ filePath, usage: 'DOWNLOAD' }] : []
      }
      break
    }
    case 'ARTICLE': {
      const item = await reader.article.findUnique({ where: { id: sourceId }, select: { content: true, cover: true } })
      if (item) { content = item.content; addMedia(item.cover) }
      break
    }
    case 'SYSTEM_HOMEPAGE': {
      const item = await reader.systemHomepage.findUnique({ where: { id: sourceId }, select: { content: true } })
      if (item) content = item.content
      break
    }
    case 'PROJECT_AVATAR': {
      const item = await reader.project.findUnique({ where: { id: sourceId }, select: { id: true, avatar: true } })
      if (item) { projectId = item.id; addMedia(item.avatar) }
      break
    }
    case 'USER_AVATAR': {
      const item = await reader.user.findUnique({ where: { id: sourceId }, select: { avatar: true } })
      addMedia(item?.avatar)
      break
    }
    case 'SYSTEM_CONFIG': {
      const item = await reader.systemConfig.findUnique({ where: { id: sourceId }, select: { configKey: true, configValue: true } })
      if (item && ([CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH, CONFIG_KEYS.SYSTEM_FAVICON_FILE_PATH] as string[]).includes(item.configKey)) addMedia(`/${item.configValue}`)
      break
    }
  }
  const links = [...new Map((menuLinks ?? [...extractManagedFiles(content), ...mediaLinks]).map(link => [`${link.filePath}:${link.usage}`, link])).values()]
  const files = links.length ? await reader.fileManagement.findMany({
    where: { filePath: { in: [...new Set(links.map((link) => link.filePath))] } }, select: { id: true, filePath: true },
  }) : []
  await reader.fileReference.deleteMany({ where: { sourceType, sourceId } })
  // Insert-mode backups can share a physical path across multiple metadata records.
  const fileIds = new Map<string, number[]>()
  for (const file of files) fileIds.set(file.filePath, [...(fileIds.get(file.filePath) ?? []), file.id])
  const data = links.flatMap((link) => (fileIds.get(link.filePath) ?? []).map(fileId => ({
    fileId, sourceType, sourceId, projectId, usage: link.usage,
  })))
  if (data.length) await reader.fileReference.createMany({ data })
  return data.length
}

export async function rebuildFileReferences(reader: Reader) {
  const sources = await Promise.all([
    reader.noteContent.findMany({ select: { id: true } }),
    reader.projectHome.findMany({ select: { id: true } }),
    reader.projectMenu.findMany({ select: { id: true } }),
    reader.article.findMany({ select: { id: true } }),
    reader.systemHomepage.findMany({ select: { id: true } }),
    reader.project.findMany({ select: { id: true } }),
    reader.user.findMany({ select: { id: true } }),
    reader.systemConfig.findMany({ select: { id: true } }),
  ])
  const types: FileSourceType[] = ['NOTE_CONTENT', 'PROJECT_HOME', 'PROJECT_MENU', 'ARTICLE', 'SYSTEM_HOMEPAGE', 'PROJECT_AVATAR', 'USER_AVATAR', 'SYSTEM_CONFIG']
  let references = 0
  for (let index = 0; index < types.length; index++) {
    for (const item of sources[index]) references += await syncFileReferences(reader, types[index], item.id)
  }
  return references
}
