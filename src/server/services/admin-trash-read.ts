/**
 * @file admin-trash-read.ts
 * @project SlothVault
 * @module Administrator Trash Queries
 * @description Provides paginated deleted roots, on-demand hierarchy nodes, and isolated read-only previews.
 * @logic Include active ancestors needed to reach deleted descendants and mark immutable release branches hidden by deleted projects.
 * @dependencies Prisma, administrator trash types
 * @index_tags admin,trash,query,tree,preview
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import type { TrashKind } from '@/server/services/admin-trash'

type NodeRecord = { id: number; isDeleted: boolean; deletedAt: Date | null }

export type TrashNode = {
  key: string
  kind: TrashKind
  id: string
  label: string
  isDeleted: boolean
  deletedAt: Date | null
  hiddenByParent: boolean
  frozen: boolean
  hasChildren: boolean
}

function node(kind: TrashKind, record: NodeRecord, label: string, hiddenByParent: boolean, frozen: boolean, hasChildren: boolean): TrashNode {
  return { key: `${kind}:${record.id}`, kind, id: String(record.id), label, isDeleted: record.isDeleted, deletedAt: record.deletedAt, hiddenByParent, frozen, hasChildren }
}

const deletedCategory = {
  OR: [
    { isDeleted: true },
    { noteInfos: { some: { OR: [{ isDeleted: true }, { contents: { some: { isDeleted: true } } }] } } },
  ],
}
const deletedVersion = { OR: [{ isDeleted: true }, { categories: { some: deletedCategory } }] }

export async function listTrashArticles(page: number, pageSize: number, keyword: string) {
  const where = { isDeleted: true, ...(keyword ? { title: { contains: keyword } } : {}) }
  const [total, list] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }], select: { id: true, title: true, summary: true, deletedAt: true, publishedAt: true } }),
  ])
  return { total, page, pageSize, list: list.map((item) => ({ ...item, id: String(item.id) })) }
}

export async function listTrashProjects(page: number, pageSize: number, keyword: string) {
  const where = {
    ...(keyword ? { projectName: { contains: keyword } } : {}),
    OR: [
      { isDeleted: true },
      { versions: { some: deletedVersion } },
      { menus: { some: { isDeleted: true } } },
      { home: { is: { isDeleted: true } } },
    ],
  }
  const [total, list] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }], select: { id: true, projectName: true, isDeleted: true, deletedAt: true } }),
  ])
  return { total, page, pageSize, list: list.map((item) => node('project', item, item.projectName, false, false, true)) }
}

export async function listTrashChildren(kind: TrashKind, id: number): Promise<TrashNode[]> {
  if (kind === 'project') {
    const project = await prisma.project.findUnique({ where: { id }, select: { isDeleted: true, home: { select: { id: true, isDeleted: true, deletedAt: true } } } })
    if (!project) throw new HttpError('Not Found', 404, 404)
    const [versions, menus] = await Promise.all([
      prisma.projectVersion.findMany({ where: { projectId: id, ...(project.isDeleted ? {} : deletedVersion) }, select: { id: true, version: true, isDeleted: true, deletedAt: true, publishedAt: true }, orderBy: { id: 'asc' } }),
      prisma.projectMenu.findMany({ where: { projectId: id, parentId: null, ...(project.isDeleted ? {} : { OR: [{ isDeleted: true }, { children: { some: { isDeleted: true } } }] }) }, select: { id: true, label: true, isDeleted: true, deletedAt: true }, orderBy: { id: 'asc' } }),
    ])
    return [
      ...versions.map((item) => node('version', item, item.version, project.isDeleted, Boolean(item.publishedAt), true)),
      ...(project.home && (project.isDeleted || project.home.isDeleted) ? [node('home', project.home, 'Project homepage', project.isDeleted, false, false)] : []),
      ...menus.map((item) => node('menu', item, item.label, project.isDeleted, false, true)),
    ]
  }
  if (kind === 'version') {
    const version = await prisma.projectVersion.findUnique({ where: { id }, select: { isDeleted: true, publishedAt: true, project: { select: { isDeleted: true } } } })
    if (!version) throw new HttpError('Not Found', 404, 404)
    const hidden = version.isDeleted || version.project.isDeleted
    const list = await prisma.category.findMany({ where: { projectVersionId: id, ...(hidden ? {} : deletedCategory) }, select: { id: true, categoryName: true, isDeleted: true, deletedAt: true }, orderBy: { id: 'asc' } })
    return list.map((item) => node('category', item, item.categoryName, hidden, Boolean(version.publishedAt), true))
  }
  if (kind === 'category') {
    const category = await prisma.category.findUnique({ where: { id }, select: { isDeleted: true, projectVersion: { select: { isDeleted: true, publishedAt: true, project: { select: { isDeleted: true } } } } } })
    if (!category) throw new HttpError('Not Found', 404, 404)
    const hidden = category.isDeleted || category.projectVersion.isDeleted || category.projectVersion.project.isDeleted
    const list = await prisma.noteInfo.findMany({ where: { categoryId: id, ...(hidden ? {} : { OR: [{ isDeleted: true }, { contents: { some: { isDeleted: true } } }] }) }, select: { id: true, noteTitle: true, isDeleted: true, deletedAt: true }, orderBy: { id: 'asc' } })
    return list.map((item) => node('note', item, item.noteTitle, hidden, Boolean(category.projectVersion.publishedAt), true))
  }
  if (kind === 'note') {
    const noteInfo = await prisma.noteInfo.findUnique({ where: { id }, select: { isDeleted: true, category: { select: { isDeleted: true, projectVersion: { select: { isDeleted: true, publishedAt: true, project: { select: { isDeleted: true } } } } } } } })
    if (!noteInfo) throw new HttpError('Not Found', 404, 404)
    const version = noteInfo.category.projectVersion
    const hidden = noteInfo.isDeleted || noteInfo.category.isDeleted || version.isDeleted || version.project.isDeleted
    const list = await prisma.noteContent.findMany({ where: { noteInfoId: id, ...(hidden ? {} : { isDeleted: true }) }, select: { id: true, versionNote: true, isDeleted: true, deletedAt: true }, orderBy: { id: 'desc' } })
    return list.map((item) => node('content', item, item.versionNote || `#${item.id}`, hidden, Boolean(version.publishedAt), false))
  }
  if (kind === 'menu') {
    const menu = await prisma.projectMenu.findUnique({ where: { id }, select: { isDeleted: true, project: { select: { isDeleted: true } } } })
    if (!menu) throw new HttpError('Not Found', 404, 404)
    const list = await prisma.projectMenu.findMany({ where: { parentId: id, ...(menu.isDeleted || menu.project.isDeleted ? {} : { isDeleted: true }) }, select: { id: true, label: true, isDeleted: true, deletedAt: true }, orderBy: { id: 'asc' } })
    return list.map((item) => node('menu', item, item.label, menu.isDeleted || menu.project.isDeleted, false, false))
  }
  return []
}

export async function getTrashPreview(kind: TrashKind, id: number) {
  if (kind === 'article') {
    const article = await prisma.article.findUnique({ where: { id }, select: { title: true, summary: true, content: true, isDeleted: true, deletedAt: true } })
    if (!article?.isDeleted) throw new HttpError('Not Found', 404, 404)
    return article
  }
  if (kind === 'content') {
    const content = await prisma.noteContent.findUnique({ where: { id }, select: { versionNote: true, content: true, isDeleted: true, deletedAt: true, noteInfo: { select: { isDeleted: true, category: { select: { isDeleted: true, projectVersion: { select: { publishedAt: true, isDeleted: true, project: { select: { isDeleted: true } } } } } } } } } })
    if (!content || !(content.isDeleted || content.noteInfo.isDeleted || content.noteInfo.category.isDeleted || content.noteInfo.category.projectVersion.isDeleted || content.noteInfo.category.projectVersion.project.isDeleted)) throw new HttpError('Not Found', 404, 404)
    return { title: content.versionNote || `#${id}`, content: content.content, isDeleted: content.isDeleted, deletedAt: content.deletedAt }
  }
  if (kind === 'home') {
    const home = await prisma.projectHome.findUnique({ where: { id }, select: { content: true, isDeleted: true, deletedAt: true, project: { select: { isDeleted: true } } } })
    if (!home || !(home.isDeleted || home.project.isDeleted)) throw new HttpError('Not Found', 404, 404)
    return { title: 'Project homepage', content: home.content, isDeleted: home.isDeleted, deletedAt: home.deletedAt }
  }
  if (kind === 'menu') {
    const menu = await prisma.projectMenu.findUnique({ where: { id }, select: { label: true, url: true, isDeleted: true, deletedAt: true, parent: { select: { isDeleted: true } }, project: { select: { isDeleted: true } } } })
    if (!menu || !(menu.isDeleted || menu.parent?.isDeleted || menu.project.isDeleted)) throw new HttpError('Not Found', 404, 404)
    return { title: menu.label, content: menu.url || '', isDeleted: menu.isDeleted, deletedAt: menu.deletedAt }
  }
  throw new HttpError('Preview not available for this kind', 400, 400)
}
