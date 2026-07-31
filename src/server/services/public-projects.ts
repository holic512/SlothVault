/**
 * @file public-projects.ts
 * @project SlothVault
 * @module Public Project Reading
 * @description Centralizes public collection navigation and article reads, including author identity and optional copyright evidence.
 * @logic Validate published ownership relationships, keep reading independent from wallets, and expose only matching author-bound cNFT evidence.
 * @dependencies Prisma project, document, user, and compressed NFT models
 * @index_tags public-project,public-reader,versions,notes,author,copyright,web2
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export async function listPublicProjects() {
  const list = await prisma.project.findMany({
    where: { isDeleted: false, status: 1 },
    orderBy: { weight: 'desc' },
    include: {
      versions: {
        where: { isDeleted: false, status: 1 },
        orderBy: { weight: 'desc' },
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
      id: project.id.toString(),
      projectName: project.projectName,
      avatar: project.avatar,
      latestVersion: latestVersion?.version || null,
      latestVersionDesc: latestVersion?.description || null,
      categoryCount: latestVersion?._count.categories || 0,
      requireAuth: false,
      updatedAt: project.updatedAt,
    }
  })
}

export async function getPublicProject(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, isDeleted: false, status: 1 },
    select: {
      id: true,
      projectName: true,
      avatar: true,
      status: true,
      updatedAt: true,
    },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
  return { ...project, id: project.id.toString(), requireAuth: false }
}

async function requirePublishedProject(projectId: number) {
  return getPublicProject(projectId)
}

export async function getProjectHome(projectId: number) {
  await requirePublishedProject(projectId)
  const home = await prisma.projectHome.findUnique({ where: { projectId } })
  if (!home || home.isDeleted || home.status !== 1) {
    throw new HttpError('Home content not found', 404, 404)
  }
  return {
    id: home.id.toString(),
    projectId: home.projectId.toString(),
    content: home.content,
    updatedAt: home.updatedAt,
  }
}

export async function getProjectMenu(projectId: number) {
  await requirePublishedProject(projectId)
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

  return list.map((menu) => ({
    id: menu.id.toString(),
    label: menu.label,
    url: menu.url,
    isExternal: menu.isExternal,
    weight: menu.weight,
    children: menu.children.map((child) => ({
      id: child.id.toString(),
      label: child.label,
      url: child.url,
      isExternal: child.isExternal,
      weight: child.weight,
      children: [],
    })),
  }))
}

export async function getProjectVersions(projectId: number) {
  await requirePublishedProject(projectId)
  const versions = await prisma.projectVersion.findMany({
    where: { projectId, isDeleted: false, status: 1 },
    orderBy: { weight: 'desc' },
    select: { id: true, version: true, description: true, weight: true },
  })
  return versions.map((version) => ({ ...version, id: version.id.toString() }))
}

async function requireVersion(projectId: number, versionId: number) {
  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId, isDeleted: false, status: 1 },
    include: { project: { select: { isDeleted: true, status: true } } },
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
        select: { id: true, noteTitle: true, weight: true },
      },
    },
  })
  return categories.map((category) => ({
    id: category.id.toString(),
    categoryName: category.categoryName,
    weight: category.weight,
    notes: category.noteInfos.map((note) => ({
      id: note.id.toString(),
      noteTitle: note.noteTitle,
      weight: note.weight,
    })),
  }))
}

export async function getProjectNote(
  projectId: number,
  versionId: number,
  noteId: number,
) {
  await requireVersion(projectId, versionId)
  const note = await prisma.noteInfo.findFirst({
    where: {
      id: noteId,
      isDeleted: false,
      status: 1,
      category: { projectVersionId: versionId, isDeleted: false, status: 1 },
    },
    select: { id: true, authorId: true, noteTitle: true },
  })
  if (!note) throw new HttpError('Note not found', 404, 404)

  const content =
    (await prisma.noteContent.findFirst({
      where: { noteInfoId: noteId, isPrimary: true, isDeleted: false, status: 1 },
      orderBy: { updatedAt: 'desc' },
    })) ||
    (await prisma.noteContent.findFirst({
      where: { noteInfoId: noteId, isDeleted: false, status: 1 },
      orderBy: { createdAt: 'desc' },
    }))
  if (!content) throw new HttpError('Note content not found', 404, 404)

  const [author, certificate] = await Promise.all([
    note.authorId
      ? prisma.user.findFirst({
          where: { id: note.authorId, status: 1 },
          select: { username: true, displayName: true },
        })
      : null,
    note.authorId
      ? prisma.compressedNft.findFirst({
          where: {
            noteInfoId: note.id,
            copyrightOwnerId: note.authorId,
            status: 1,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            assetId: true,
            mintTxSignature: true,
            ownerAddress: true,
            createdAt: true,
            merkleTree: { select: { network: true } },
          },
        })
      : null,
  ])

  return {
    id: content.id.toString(),
    noteId: note.id.toString(),
    noteTitle: note.noteTitle,
    content: content.content,
    versionNote: content.versionNote,
    updatedAt: content.updatedAt,
    author: author
      ? {
          username: author.username,
          displayName: author.displayName,
        }
      : null,
    certificate: certificate
      ? {
          assetId: certificate.assetId,
          transaction: certificate.mintTxSignature,
          ownerAddress: certificate.ownerAddress,
          network: certificate.merkleTree.network,
          issuedAt: certificate.createdAt,
        }
      : null,
  }
}
