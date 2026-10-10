/**
 * @file projects.ts
 * @project SlothVault
 * @module Admin Project Administration
 * @description Implements project listing, creation, lookup, ordinary administration, MCP metadata boundaries, soft deletion, and batch actions.
 * @logic Persist independent read/download rules and managed avatars; Build Prisma filters, map stable DTOs, allow release-independent metadata edits through both admin surfaces, invalidate public ordering changes, and translate missing records consistently.
 * @dependencies server/prisma, server/http/errors, catalog values, catalog DTOs
 * @index_tags admin,catalog,project,crud,batch,mcp,metadata-boundary
 * @author holic512
 */
import 'server-only'
import { indexFileWrite, syncFileReferences } from '@/server/services/file-references'
import { unitOfWork } from '@/server/database/unit-of-work'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { publishedVersionOrder } from '@/server/services/project-version-order'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'
import { deleteProjectBatch, deleteTrashItem } from '@/server/services/admin-trash'

import {
  databaseTextContains,
  hasPrismaCode,
  integerValue,
  optionalIntegerValue,
  parseJsonDecimalIds,
} from './values'
import { parseAccessRule, projectAccessInclude } from '@/server/services/content-access'

import { projectDto, projectListDto, projectSummaryDto } from './dtos'
import type { ProjectListQuery } from './query-types'

export async function listAdminProjects(query: ProjectListQuery) {
  const where: Prisma.ProjectWhereInput = { isDeleted: false }
  if (query.keyword) where.projectName = databaseTextContains(query.keyword)
  if (Number.isFinite(query.status)) where.status = query.status

  const [total, list] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
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
            _count: {
              select: { categories: { where: { isDeleted: false } } },
            },
          },
        },
      },
    }),
  ])

  return {
    list: list.map(projectListDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function createAdminProject(input: {
  projectName?: unknown
  avatar?: unknown
  weight?: unknown
  status?: unknown
  readAccess?: unknown
  downloadAccess?: unknown
}) {
  const projectName = typeof input.projectName === 'string' ? input.projectName.trim() : ''
  if (!projectName) throw new HttpError('Missing projectName', 400, 400)

  const read = input.readAccess === undefined ? undefined : await parseAccessRule(input.readAccess)
  const download = input.downloadAccess === undefined ? undefined : await parseAccessRule(input.downloadAccess, true)
  const project = await unitOfWork.execute((tx) => indexFileWrite(tx, 'PROJECT_AVATAR', tx.project.create({
    data: {
      projectName,
      avatar: typeof input.avatar === 'string' ? input.avatar : null,
      weight: integerValue(input.weight, 0),
      status: integerValue(input.status, 1),
      requireAuth: false,
      ...(read ? { readAccessMode: read.mode, readMemberships: { create: read.membershipLevelIds.map((membershipLevelId) => ({ membershipLevelId })) } } : {}),
      ...(download ? { downloadAccessMode: download.mode, downloadMemberships: { create: download.membershipLevelIds.map((membershipLevelId) => ({ membershipLevelId })) } } : {}),
    },
    include: projectAccessInclude,
  })))
  return projectDto(project)
}

export async function getAdminProject(id: number) {
  const project = await prisma.project.findUnique({ where: { id }, include: projectAccessInclude })
  if (!project) throw new HttpError('Not Found', 404, 404)
  return projectDto(project)
}

export async function updateAdminProject(
  id: number,
  input: {
    projectName?: unknown
    avatar?: unknown
    weight?: unknown
    status?: unknown
    readAccess?: unknown
    downloadAccess?: unknown
  },
) {
  const data: Prisma.ProjectUpdateInput = { updatedAt: new Date() }

  if (typeof input.projectName === 'string') {
    const projectName = input.projectName.trim()
    if (!projectName) throw new HttpError('Invalid projectName', 400, 400)
    data.projectName = projectName
  }
  if (input.avatar !== undefined) {
    if (input.avatar !== null && typeof input.avatar !== 'string') {
      throw new HttpError('Invalid avatar', 400, 400)
    }
    data.avatar = input.avatar
  }

  if (input.readAccess !== undefined) {
    const rule = await parseAccessRule(input.readAccess)
    data.readAccessMode = rule.mode
    data.readMemberships = { deleteMany: {}, create: rule.membershipLevelIds.map((membershipLevelId) => ({ membershipLevelId })) }
  }
  if (input.downloadAccess !== undefined) {
    const rule = await parseAccessRule(input.downloadAccess, true)
    data.downloadAccessMode = rule.mode
    data.downloadMemberships = { deleteMany: {}, create: rule.membershipLevelIds.map((membershipLevelId) => ({ membershipLevelId })) }
  }
  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const project = await unitOfWork.execute((tx) => indexFileWrite(tx, 'PROJECT_AVATAR', tx.project.update({ where: { id }, data, include: projectAccessInclude })))
    await invalidatePublicProjectCache(id)
    return projectDto(project)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function updateAdminProjectMetadataFromMcp(
  id: number,
  input: {
    projectName?: unknown
    avatar?: unknown
    weight?: unknown
  },
) {
  const data: Prisma.ProjectUpdateManyMutationInput = { updatedAt: new Date() }

  if (typeof input.projectName === 'string') {
    const projectName = input.projectName.trim()
    if (!projectName) throw new HttpError('Invalid projectName', 400, 400)
    data.projectName = projectName
  }
  if (input.avatar !== undefined) {
    if (input.avatar !== null && typeof input.avatar !== 'string') {
      throw new HttpError('Invalid avatar', 400, 400)
    }
    data.avatar = input.avatar
  }
  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  const project = await unitOfWork.execute(async (tx) => {
    const updated = await tx.project.updateMany({ where: { id, isDeleted: false }, data })
    if (updated.count !== 1) throw new HttpError('Not Found', 404, 404)
    await syncFileReferences(tx, 'PROJECT_AVATAR', id)
    return tx.project.findUniqueOrThrow({ where: { id }, include: projectAccessInclude })
  })
  await invalidatePublicProjectCache(id)
  return projectDto(project)
}

export async function deleteAdminProject(id: number) {
  await deleteTrashItem('project', id)
  const project = await prisma.project.findUniqueOrThrow({ where: { id } })
  return projectSummaryDto(project)
}

export async function applyAdminProjectBatch(input: {
  action?: unknown
  ids?: unknown
  status?: unknown
}) {
  const action = typeof input.action === 'string' ? input.action : ''
  const ids = parseJsonDecimalIds(input.ids)
  if (!action || !ids) throw new HttpError('Missing action or ids', 400, 400)

  if (action === 'delete') {
    return deleteProjectBatch(ids)
  }
  if (action === 'setStatus') {
    const status = optionalIntegerValue(input.status)
    if (status === null) throw new HttpError('Missing status', 400, 400)
    const result = await prisma.project.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { status, updatedAt: new Date() },
    })
    await Promise.all(ids.map((id) => invalidatePublicProjectCache(id)))
    return { count: result.count }
  }
  throw new HttpError('Invalid action', 400, 400)
}
