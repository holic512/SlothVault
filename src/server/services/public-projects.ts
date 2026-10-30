/**
 * @file public-projects.ts
 * @project SlothVault
 * @module Public Project Reading
 * @description Centralizes public immutable project navigation, manifest metadata, document reads, and version transaction evidence.
 * @logic Require a visible published release, return parent and child navigation with raw nullable icon keys, resolve optional homepages, and expose release evidence with independent membership reading policies.
 * @dependencies Prisma project, document, and release credential models
 * @index_tags public-project,public-reader,versions,notes,evidence,permissions
 * @author holic512
 */
import 'server-only'
import { publishedProjectWhere } from './public-content-ids'
import { presentContentLinks, presentContentUrls } from './public-content-links'
import { readNoteTags } from '@/lib/note-tags'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import type { AccessViewer } from '@/lib/content-access'
import { projectAccessInclude, projectPolicyDto, resolveProjectAccess, requireProjectCapability } from './content-access'
import { publishedVersionOrder } from '@/server/services/project-version-order'

export async function listPublicProjects() {
  const list = await prisma.project.findMany({
    where: {
      isDeleted: false,
      status: 1,
      versions: {
        some: {
          isDeleted: false,
          status: 1,
          publishedAt: { not: null },
          releaseId: { not: null },
          releaseHash: { not: null },
          manifestVersion: 3,
        },
      },
    },
    orderBy: { weight: 'desc' },
    include: {
      ...projectAccessInclude,
      versions: {
        where: {
          isDeleted: false,
          status: 1,
          publishedAt: { not: null },
          releaseId: { not: null },
          releaseHash: { not: null },
          manifestVersion: 3,
        },
        orderBy: publishedVersionOrder,
        take: 1,
        include: {
          _count: { select: { categories: { where: { isDeleted: false } } } },
        },
      },
    },
  })

  return list.map((project) => {
    const latestVersion = project.versions[0]
    return {
      id: project.publicId,
      projectName: project.projectName,
      avatar: project.avatar,
      latestVersion: latestVersion?.version || null,
      latestVersionDesc: latestVersion?.description || null,
      categoryCount: latestVersion?._count.categories || 0,
      requireAuth: false,
      ...projectPolicyDto(project),
      updatedAt: project.updatedAt,
    }
  })
}

export async function getPublicProject(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...publishedProjectWhere },
    select: {
      publicId: true,
      projectName: true,
      avatar: true,
      status: true,
      updatedAt: true,
      readAccessMode: true,
      downloadAccessMode: true,
      ...projectAccessInclude,
    },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
  return { id: project.publicId, projectName: project.projectName, avatar: project.avatar, status: project.status, updatedAt: project.updatedAt, requireAuth: false, ...projectPolicyDto(project) }
}

async function requirePublishedProject(projectId: number) {
  return getPublicProject(projectId)
}

export async function getProjectHome(projectId: number) {
  const home = await findPublicProjectHome(projectId)
  if (!home) throw new HttpError('Home content not found', 404, 404)
  return home
}

export async function findPublicProjectHome(projectId: number) {
  const project = await requirePublishedProject(projectId)
  const home = await prisma.projectHome.findUnique({ where: { projectId } })
  if (!home || home.isDeleted || home.status !== 1) return null
  return {
    projectId: project.id,
    content: await presentContentLinks(home.content),
    updatedAt: home.updatedAt,
  }
}

export async function getProjectMenu(projectId: number) {
  const project = await requirePublishedProject(projectId)
  const list = await prisma.projectMenu.findMany({
    where: { projectId, parentId: null, isDeleted: false, status: 1 },
    include: {
      children: {
        where: { isDeleted: false, status: 1 },
        orderBy: { weight: 'desc' },
      },
    },
    orderBy: { weight: 'desc' },
  })

  const urls = list.flatMap(menu => [menu.url, ...menu.children.map(child => child.url)]).filter((url): url is string => url !== null)
  const localUrls = urls.map(url => /^\/(?:v\/|home(?:[?#]|$)|docs(?:[?#]|$))/.test(url) ? `/project/${project.id}${url}` : url)
  const converted = await presentContentUrls(localUrls)
  const links = new Map(urls.map((url, index) => [url, converted.get(localUrls[index])!]))
  return list.map((menu, index) => ({
    key: `menu-${index}`,
    label: menu.label,
    icon: menu.icon,
    url: menu.url === null ? null : links.get(menu.url)!,
    isExternal: menu.isExternal,
    weight: menu.weight,
    children: menu.children.map((child, childIndex) => ({
      key: `menu-${index}-${childIndex}`,
      label: child.label,
      icon: child.icon,
      url: child.url === null ? null : links.get(child.url)!,
      isExternal: child.isExternal,
      weight: child.weight,
      children: [],
    })),
  }))
}

export async function getProjectVersions(projectId: number) {
  await requirePublishedProject(projectId)
  const versions = await prisma.projectVersion.findMany({
    where: {
      projectId,
      isDeleted: false,
      status: 1,
      publishedAt: { not: null },
      releaseId: { not: null },
      releaseHash: { not: null },
      manifestVersion: 3,
    },
    orderBy: publishedVersionOrder,
    select: {
      publicId: true,
      version: true,
      description: true,
      weight: true,
      releaseId: true,
      releaseHash: true,
      manifestVersion: true,
      publishedAt: true,
    },
  })
  return versions.map(({ publicId, ...version }) => ({ ...version, id: publicId }))
}

async function requireVersion(projectId: number, versionId: number) {
  const version = await prisma.projectVersion.findFirst({
    where: {
      id: versionId,
      projectId,
      isDeleted: false,
      status: 1,
      publishedAt: { not: null },
      releaseId: { not: null },
      releaseHash: { not: null },
      manifestVersion: 3,
    },
    include: {
      project: { select: { isDeleted: true, status: true } },
    },
  })
  if (!version || version.project.isDeleted || version.project.status !== 1) {
    throw new HttpError('Version not found', 404, 404)
  }
  await requirePublishedProject(projectId)
  return version
}

export async function getProjectSidebar(
  projectId: number,
  versionId: number,
) {
  await requireVersion(projectId, versionId)
  const categories = await prisma.category.findMany({
    where: { projectVersionId: versionId, isDeleted: false, status: 1 },
    orderBy: { weight: 'desc' },
    include: {
      noteInfos: {
        where: { isDeleted: false, status: 1 },
        orderBy: { weight: 'desc' },
        select: { publicId: true, noteTitle: true, weight: true },
      },
    },
  })
  return categories.map((category, index) => ({
    key: `category-${index}`,
    categoryName: category.categoryName,
    weight: category.weight,
    notes: category.noteInfos.map((note) => ({
      id: note.publicId,
      noteTitle: note.noteTitle,
      weight: note.weight,
    })),
  }))
}

export async function getProjectNote(
  projectId: number,
  versionId: number,
  noteId: number,
  viewer: AccessViewer = null,
) {
  await requireVersion(projectId, versionId)
  const note = await prisma.noteInfo.findFirst({
    where: {
      id: noteId,
      isDeleted: false,
      status: 1,
      category: { projectVersionId: versionId, isDeleted: false, status: 1 },
      contents: { some: { isPrimary: true, isDeleted: false, status: 1 } },
    },
    select: { publicId: true, noteTitle: true, tagsJson: true },
  })
  if (!note) throw new HttpError('Note not found', 404, 404)
  requireProjectCapability(await resolveProjectAccess(projectId, viewer), 'read')

  const contents = await prisma.noteContent.findMany({
    where: { noteInfoId: noteId, isPrimary: true, isDeleted: false, status: 1 },
    take: 2,
  })
  const content = contents.length === 1 ? contents[0] : null
  if (!content) throw new HttpError('Note content not found', 404, 404)

  return {
    noteId: note.publicId,
    noteTitle: note.noteTitle,
    tags: readNoteTags(note.tagsJson),
    content: await presentContentLinks(content.content),
    versionNote: content.versionNote,
    updatedAt: content.updatedAt,
  }
}

export async function getProjectNoteMetadata(projectId: number, versionId: number, noteId: number) {
  await requireVersion(projectId, versionId)
  const note = await prisma.noteInfo.findFirst({
    where: { id: noteId, isDeleted: false, status: 1, category: { projectVersionId: versionId, isDeleted: false, status: 1 }, contents: { some: { isPrimary: true, isDeleted: false, status: 1 } } },
    select: { publicId: true, noteTitle: true, tagsJson: true },
  })
  if (!note) throw new HttpError('Note not found', 404, 404)
  return { id: note.publicId, noteTitle: note.noteTitle, tags: readNoteTags(note.tagsJson) }
}
