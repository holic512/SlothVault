/**
 * @file admin-trash.ts
 * @project SlothVault
 * @module Administrator Content Trash
 * @description Lists deleted content with its ancestors and owns cascade deletion and ancestor-aware restoration.
 * @logic Serialize draft-tree mutations by version revision, preserve frozen releases, and restore only the selected item plus missing ancestors.
 * @dependencies Prisma, project-version release write lock, public cache invalidation
 * @index_tags admin,trash,soft-delete,restore,hierarchy,release
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { invalidatePublicArticleCache } from '@/server/services/public-article-cache'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'
import { executeVersionWrite, lockDraftProjectVersions } from '@/server/services/project-version-release'

export type TrashKind = 'article' | 'project' | 'version' | 'category' | 'note' | 'content' | 'home' | 'menu'
type Transaction = Prisma.TransactionClient

const missing = () => new HttpError('Deleted item not found', 404, 404)
const frozen = () => new HttpError('Published project version is frozen', 409, 409, { reason: 'VERSION_FROZEN' })

async function draftVersion(tx: Transaction, versionId: number, allowDeleted = false) {
  const updated = await tx.projectVersion.updateMany({
    where: { id: versionId, publishedAt: null, ...(allowDeleted ? {} : { isDeleted: false }) },
    data: { documentRevision: { increment: 1 }, updatedAt: new Date() },
  })
  if (updated.count !== 1) {
    const existing = await tx.projectVersion.findUnique({ where: { id: versionId }, select: { publishedAt: true } })
    if (existing?.publishedAt) throw frozen()
    throw missing()
  }
}

async function deleteContents(tx: Transaction, noteIds: number[], now: Date) {
  if (!noteIds.length) return
  await tx.noteContent.updateMany({
    where: { noteInfoId: { in: noteIds }, isDeleted: false },
    data: { isDeleted: true, deletedAt: now, isPrimary: false, updatedAt: now },
  })
}

async function deleteNotes(tx: Transaction, categoryIds: number[], now: Date) {
  if (!categoryIds.length) return
  const notes = await tx.noteInfo.findMany({ where: { categoryId: { in: categoryIds } }, select: { id: true } })
  await deleteContents(tx, notes.map((note) => note.id), now)
  await tx.noteInfo.updateMany({
    where: { categoryId: { in: categoryIds }, isDeleted: false },
    data: { isDeleted: true, deletedAt: now, updatedAt: now },
  })
}

async function deleteCategories(tx: Transaction, versionIds: number[], now: Date) {
  if (!versionIds.length) return
  const categories = await tx.category.findMany({ where: { projectVersionId: { in: versionIds } }, select: { id: true } })
  await deleteNotes(tx, categories.map((category) => category.id), now)
  await tx.category.updateMany({
    where: { projectVersionId: { in: versionIds }, isDeleted: false },
    data: { isDeleted: true, deletedAt: now, updatedAt: now },
  })
}

async function deleteProject(tx: Transaction, id: number, now: Date) {
  const project = await tx.project.findUnique({ where: { id }, select: { isDeleted: true } })
  if (!project || project.isDeleted) throw missing()
  const versions = await tx.projectVersion.findMany({
    where: { projectId: id, publishedAt: null }, select: { id: true }, orderBy: { id: 'asc' },
  })
  for (const version of versions) await draftVersion(tx, version.id, true)
  const versionIds = versions.map((version) => version.id)
  await deleteCategories(tx, versionIds, now)
  if (versionIds.length) await tx.projectVersion.updateMany({
    where: { id: { in: versionIds }, isDeleted: false },
    data: { isDeleted: true, deletedAt: now, status: 0, updatedAt: now },
  })
  await tx.projectMenu.updateMany({ where: { projectId: id, isDeleted: false }, data: { isDeleted: true, deletedAt: now, updatedAt: now } })
  await tx.projectHome.updateMany({ where: { projectId: id, isDeleted: false }, data: { isDeleted: true, deletedAt: now, updatedAt: now } })
  await tx.project.update({ where: { id }, data: { isDeleted: true, deletedAt: now, status: 0, updatedAt: now } })
}

export async function deleteTrashItem(kind: TrashKind, id: number) {
  const now = new Date()
  if (kind === 'article') {
    const changed = await prisma.article.updateMany({ where: { id, isDeleted: false }, data: { isDeleted: true, deletedAt: now, status: 0, updatedAt: now } })
    if (!changed.count) throw missing()
    await invalidatePublicArticleCache(id)
    return
  }
  if (kind === 'project') {
    await executeVersionWrite((tx) => deleteProject(tx, id, now))
    await invalidatePublicProjectCache(id)
    return
  }
  if (kind === 'menu' || kind === 'home') {
    const projectId = await prisma.$transaction(async (tx) => {
      const entry = kind === 'menu'
        ? await tx.projectMenu.findUnique({ where: { id }, select: { projectId: true, isDeleted: true } })
        : await tx.projectHome.findUnique({ where: { id }, select: { projectId: true, isDeleted: true } })
      if (!entry || entry.isDeleted) throw missing()
      if (kind === 'menu') {
        const ids = [id]
        const children = await tx.projectMenu.findMany({ where: { parentId: id }, select: { id: true } })
        ids.push(...children.map((child) => child.id))
        await tx.projectMenu.updateMany({ where: { id: { in: ids }, isDeleted: false }, data: { isDeleted: true, deletedAt: now, updatedAt: now } })
      } else {
        await tx.projectHome.update({ where: { id }, data: { isDeleted: true, deletedAt: now, updatedAt: now } })
      }
      return entry.projectId
    })
    await invalidatePublicProjectCache(projectId)
    return
  }

  await executeVersionWrite(async (tx) => {
    const ancestry = await locateDraftItem(tx, kind, id)
    await lockDraftProjectVersions(tx, [ancestry.versionId])
    if (kind === 'version') {
      await deleteCategories(tx, [id], now)
      await tx.projectVersion.update({ where: { id }, data: { isDeleted: true, deletedAt: now, status: 0, updatedAt: now } })
    } else if (kind === 'category') {
      await deleteNotes(tx, [id], now)
      await tx.category.update({ where: { id }, data: { isDeleted: true, deletedAt: now, updatedAt: now } })
    } else if (kind === 'note') {
      await deleteContents(tx, [id], now)
      await tx.noteInfo.update({ where: { id }, data: { isDeleted: true, deletedAt: now, updatedAt: now } })
    } else if (kind === 'content') {
      const content = await tx.noteContent.findUnique({ where: { id }, select: { noteInfoId: true, isPrimary: true } })
      await tx.noteContent.update({ where: { id }, data: { isDeleted: true, deletedAt: now, isPrimary: false, updatedAt: now } })
      if (content?.isPrimary) {
        const next = await tx.noteContent.findFirst({ where: { noteInfoId: content.noteInfoId, isDeleted: false }, orderBy: { id: 'desc' }, select: { id: true } })
        if (next) await tx.noteContent.update({ where: { id: next.id }, data: { isPrimary: true, updatedAt: now } })
      }
    }
  })
}

async function locateDraftItem(tx: Transaction, kind: TrashKind, id: number) {
  if (kind === 'version') {
    const version = await tx.projectVersion.findUnique({ where: { id }, select: { id: true, projectId: true, isDeleted: true, publishedAt: true } })
    if (!version) throw missing()
    if (version.publishedAt) throw frozen()
    if (version.isDeleted) throw missing()
    return { versionId: id, projectId: version.projectId }
  }
  if (kind === 'category') {
    const category = await tx.category.findUnique({ where: { id }, select: { isDeleted: true, projectVersionId: true, projectVersion: { select: { projectId: true, publishedAt: true } } } })
    if (!category) throw missing()
    if (category.projectVersion.publishedAt) throw frozen()
    if (category.isDeleted) throw missing()
    return { versionId: category.projectVersionId, projectId: category.projectVersion.projectId }
  }
  const note = kind === 'note'
    ? await tx.noteInfo.findUnique({ where: { id }, select: { id: true, isDeleted: true, category: { select: { projectVersionId: true, projectVersion: { select: { projectId: true, publishedAt: true } } } } } })
    : await tx.noteContent.findUnique({ where: { id }, select: { isDeleted: true, noteInfo: { select: { category: { select: { projectVersionId: true, projectVersion: { select: { projectId: true, publishedAt: true } } } } } } } })
  if (!note) throw missing()
  const category = kind === 'note' ? (note as { category: { projectVersionId: number; projectVersion: { projectId: number; publishedAt: Date | null } } }).category
    : (note as { noteInfo: { category: { projectVersionId: number; projectVersion: { projectId: number; publishedAt: Date | null } } } }).noteInfo.category
  if (category.projectVersion.publishedAt) throw frozen()
  if (note.isDeleted) throw missing()
  return { versionId: category.projectVersionId, projectId: category.projectVersion.projectId }
}

export async function deleteProjectBatch(ids: number[]) {
  const now = new Date()
  const uniqueIds = [...new Set(ids)].sort((left, right) => left - right)
  await executeVersionWrite(async (tx) => {
    for (const id of uniqueIds) await deleteProject(tx, id, now)
  })
  await Promise.all(uniqueIds.map(invalidatePublicProjectCache))
  return { count: uniqueIds.length }
}

export async function deleteVersionBatch(ids: number[]) {
  const now = new Date()
  const uniqueIds = [...new Set(ids)]
  await executeVersionWrite(async (tx) => {
    await lockDraftProjectVersions(tx, uniqueIds)
    await deleteCategories(tx, uniqueIds, now)
    const changed = await tx.projectVersion.updateMany({ where: { id: { in: uniqueIds }, isDeleted: false, publishedAt: null }, data: { isDeleted: true, deletedAt: now, status: 0, updatedAt: now } })
    if (changed.count !== uniqueIds.length) throw missing()
  })
  return { count: uniqueIds.length }
}

export async function restoreTrashItem(kind: TrashKind, id: number) {
  const now = new Date()
  if (kind === 'article') {
    const changed = await prisma.article.updateMany({ where: { id, isDeleted: true }, data: { isDeleted: false, deletedAt: null, status: 0, updatedAt: now } })
    if (!changed.count) throw missing()
    await invalidatePublicArticleCache(id)
    return
  }
  let projectId: number
  if (kind === 'project' || kind === 'menu' || kind === 'home') {
    projectId = await prisma.$transaction(async (tx) => {
      if (kind === 'project') {
        const changed = await tx.project.updateMany({ where: { id, isDeleted: true }, data: { isDeleted: false, deletedAt: null, status: 1, updatedAt: now } })
        if (!changed.count) throw missing()
        return id
      }
      const item = kind === 'menu'
        ? await tx.projectMenu.findUnique({ where: { id }, select: { projectId: true, parentId: true, isDeleted: true } })
        : await tx.projectHome.findUnique({ where: { id }, select: { projectId: true, isDeleted: true } })
      if (!item) throw missing()
      const project = await tx.project.findUnique({ where: { id: item.projectId }, select: { isDeleted: true } })
      const parentId = kind === 'menu' && 'parentId' in item && typeof item.parentId === 'number' ? item.parentId : null
      const parent = parentId ? await tx.projectMenu.findUnique({ where: { id: parentId }, select: { isDeleted: true } }) : null
      if (!project || !(item.isDeleted || project.isDeleted || parent?.isDeleted)) throw missing()
      await tx.project.updateMany({ where: { id: item.projectId, isDeleted: true }, data: { isDeleted: false, deletedAt: null, status: 1, updatedAt: now } })
      if (kind === 'menu') {
        if (parentId) await tx.projectMenu.updateMany({ where: { id: parentId, isDeleted: true }, data: { isDeleted: false, deletedAt: null, updatedAt: now } })
        if (item.isDeleted) await tx.projectMenu.update({ where: { id }, data: { isDeleted: false, deletedAt: null, updatedAt: now } })
      } else if (item.isDeleted) {
        await tx.projectHome.update({ where: { id }, data: { isDeleted: false, deletedAt: null, updatedAt: now } })
      }
      return item.projectId
    })
  } else {
    projectId = await executeVersionWrite(async (tx) => {
      const ancestry = await restoreAncestry(tx, kind, id)
      await draftVersion(tx, ancestry.versionId, true)
      await tx.project.updateMany({ where: { id: ancestry.projectId, isDeleted: true }, data: { isDeleted: false, deletedAt: null, status: 1, updatedAt: now } })
      await tx.projectVersion.updateMany({ where: { id: ancestry.versionId, isDeleted: true }, data: { isDeleted: false, deletedAt: null, status: 0, updatedAt: now } })
      if (ancestry.categoryId) await tx.category.updateMany({ where: { id: ancestry.categoryId, isDeleted: true }, data: { isDeleted: false, deletedAt: null, updatedAt: now } })
      if (ancestry.noteId) await tx.noteInfo.updateMany({ where: { id: ancestry.noteId, isDeleted: true }, data: { isDeleted: false, deletedAt: null, updatedAt: now } })
      if (kind === 'content' && ancestry.itemDeleted) {
        await tx.noteContent.update({ where: { id }, data: { isDeleted: false, deletedAt: null, updatedAt: now } })
        const primary = await tx.noteContent.findFirst({ where: { noteInfoId: ancestry.noteId, isDeleted: false, isPrimary: true }, select: { id: true } })
        if (!primary) await tx.noteContent.update({ where: { id }, data: { isPrimary: true } })
      }
      return ancestry.projectId
    })
  }
  await invalidatePublicProjectCache(projectId)
}

async function restoreAncestry(tx: Transaction, kind: TrashKind, id: number) {
  const item = kind === 'version'
    ? await tx.projectVersion.findUnique({ where: { id }, select: { isDeleted: true, projectId: true, publishedAt: true } })
    : kind === 'category'
      ? await tx.category.findUnique({ where: { id }, select: { isDeleted: true, projectVersionId: true } })
      : kind === 'note'
        ? await tx.noteInfo.findUnique({ where: { id }, select: { isDeleted: true, categoryId: true } })
        : await tx.noteContent.findUnique({ where: { id }, select: { isDeleted: true, noteInfoId: true } })
  if (!item) throw missing()
  const noteId = 'noteInfoId' in item ? item.noteInfoId : kind === 'note' ? id : undefined
  const note = noteId ? await tx.noteInfo.findUnique({ where: { id: noteId }, select: { categoryId: true, isDeleted: true } }) : null
  const categoryId = 'categoryId' in item ? item.categoryId : note?.categoryId ?? (kind === 'category' ? id : undefined)
  const category = categoryId ? await tx.category.findUnique({ where: { id: categoryId }, select: { projectVersionId: true, isDeleted: true } }) : null
  const versionId = 'projectVersionId' in item ? item.projectVersionId : category?.projectVersionId ?? id
  const version = await tx.projectVersion.findUnique({ where: { id: versionId }, select: { projectId: true, publishedAt: true, isDeleted: true } })
  if (version?.publishedAt) throw frozen()
  if (!version) throw missing()
  const project = await tx.project.findUnique({ where: { id: version.projectId }, select: { isDeleted: true } })
  if (!project || !(item.isDeleted || note?.isDeleted || category?.isDeleted || version.isDeleted || project.isDeleted)) throw missing()
  return { versionId, projectId: version.projectId, categoryId, noteId, itemDeleted: item.isDeleted }
}
