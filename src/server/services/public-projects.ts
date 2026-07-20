/**
 * @file public-projects.ts
 * @project SlothVault
 * @module Public Project Reading
 * @description Centralizes project, navigation, version, sidebar, and note queries used by public pages and APIs.
 * @logic Validate enabled ownership relationships once, authorize protected reads, and map all BigInt identifiers to strings.
 * @dependencies Prisma project/document models, project-access, wallet-proof
 * @index_tags public-project,reader,versions,notes
 * @author holic512
 */
import 'server-only'

import type { NextRequest } from 'next/server'

import { readWalletProof, verifyWalletProof } from '@/server/auth/wallet-proof'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { verifyProjectAccess } from '@/server/services/project-access'

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
      requireAuth: project.requireAuth,
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
      requireAuth: true,
      status: true,
      updatedAt: true,
    },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
  return { ...project, id: project.id.toString() }
}

async function requireReadAccess(request: NextRequest, projectId: number) {
  const project = await getPublicProject(projectId)
  if (!project.requireAuth) return project

  const proof = readWalletProof(request)
  if (!proof) throw new HttpError('Wallet verification required', 403, 403)
  const walletAddress = verifyWalletProof(projectId, proof)
  const access = await verifyProjectAccess(projectId, walletAddress)
  if (!access.hasAccess) throw new HttpError(access.reason, 403, 403)
  return project
}

export async function getProjectHome(request: NextRequest, projectId: number) {
  await requireReadAccess(request, projectId)
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

export async function getProjectMenu(request: NextRequest, projectId: number) {
  await requireReadAccess(request, projectId)
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

export async function getProjectVersions(request: NextRequest, projectId: number) {
  await requireReadAccess(request, projectId)
  const versions = await prisma.projectVersion.findMany({
    where: { projectId, isDeleted: false, status: 1 },
    orderBy: { weight: 'desc' },
    select: { id: true, version: true, description: true, weight: true },
  })
  return versions.map((version) => ({ ...version, id: version.id.toString() }))
}

async function requireVersion(request: NextRequest, projectId: number, versionId: number) {
  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId, isDeleted: false, status: 1 },
    include: { project: { select: { isDeleted: true, status: true } } },
  })
  if (!version || version.project.isDeleted || version.project.status !== 1) {
    throw new HttpError('Version not found', 404, 404)
  }
  await requireReadAccess(request, projectId)
  return version
}

export async function getProjectSidebar(
  request: NextRequest,
  projectId: number,
  versionId: number,
) {
  await requireVersion(request, projectId, versionId)
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
  request: NextRequest,
  projectId: number,
  versionId: number,
  noteId: number,
) {
  await requireVersion(request, projectId, versionId)
  const note = await prisma.noteInfo.findFirst({
    where: {
      id: noteId,
      isDeleted: false,
      status: 1,
      category: { projectVersionId: versionId, isDeleted: false, status: 1 },
    },
    select: { id: true, noteTitle: true },
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

  return {
    id: content.id.toString(),
    noteId: note.id.toString(),
    noteTitle: note.noteTitle,
    content: content.content,
    versionNote: content.versionNote,
    updatedAt: content.updatedAt,
  }
}
