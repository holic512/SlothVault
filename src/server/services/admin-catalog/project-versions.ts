/**
 * @file project-versions.ts
 * @project SlothVault
 * @module Admin Project Version Administration
 * @description Implements project-version listing and detail reads, draft mutations, batch actions, and project-scoped queries around immutable releases.
 * @logic Normalize new versions to drafts, expose stable version lookup, serialize mutable writes through the version lock, route published visibility changes through the release service, and reject mixed frozen batches atomically.
 * @dependencies server/prisma, server/http/errors, catalog values, catalog DTOs, project-version release service
 * @index_tags admin,catalog,project-version,crud,batch
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'
import { projectVersionOrder } from '@/server/services/project-version-order'
import { deleteTrashItem, deleteVersionBatch } from '@/server/services/admin-trash'
import {
  executeVersionWrite,
  lockDraftProjectVersions,
  lockProjectVersionMetadata,
  isProjectVersionEmpty,
  projectVersionEmptyStates,
  setProjectVersionsVisibility,
} from '@/server/services/project-version-release'

import {
  databaseTextContains,
  hasPrismaCode,
  integerValue,
  optionalIntegerValue,
  parseJsonDecimalId,
  parseJsonDecimalIds,
} from './values'
import {
  projectSummaryDto,
  projectVersionBaseDto,
  projectVersionDto,
} from './dtos'
import type {
  ProjectVersionByProjectQuery,
  ProjectVersionListQuery,
} from './query-types'

async function requireActiveProject(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, isDeleted: false },
    select: { id: true },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
}

async function versionPage(where: Prisma.ProjectVersionWhereInput, query: ProjectVersionByProjectQuery | ProjectVersionListQuery) {
  const include = { project: 'includeProject' in query && query.includeProject }
  if (query.orderByField !== 'publishedAt') return prisma.projectVersion.findMany({
    where, skip: query.skip, take: query.pageSize, orderBy: projectVersionOrder(query.orderByField, query.order), include,
  })
  const publishedWhere = { ...where, publishedAt: { not: null } }
  const publishedCount = await prisma.projectVersion.count({ where: publishedWhere })
  const publishedTake = Math.min(query.pageSize, Math.max(0, publishedCount - query.skip))
  const released = publishedTake ? await prisma.projectVersion.findMany({
    where: publishedWhere, skip: query.skip, take: publishedTake,
    orderBy: [{ publishedAt: query.order }, { id: 'desc' }], include,
  }) : []
  const drafts = query.pageSize > publishedTake ? await prisma.projectVersion.findMany({
    where: { ...where, publishedAt: null }, skip: Math.max(0, query.skip - publishedCount), take: query.pageSize - publishedTake,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include,
  }) : []
  return [...released, ...drafts]
}

export async function listAdminProjectVersions(query: ProjectVersionListQuery) {
  const where: Prisma.ProjectVersionWhereInput = { isDeleted: false, project: { isDeleted: false } }
  if (query.keyword) {
    where.OR = [
      { version: databaseTextContains(query.keyword) },
      { description: databaseTextContains(query.keyword) },
    ]
  }
  if (Number.isFinite(query.status)) where.status = query.status
  if (query.projectId !== undefined) where.projectId = query.projectId

  const [total, list] = await Promise.all([
    prisma.projectVersion.count({ where }),
    versionPage(where, query),
  ])
  const empty = await projectVersionEmptyStates(prisma, list.map(item => item.id))
  return {
    list: list.map(item => ({ ...projectVersionDto(item), isEmpty: empty.get(item.id)! })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function createAdminProjectVersion(input: {
  projectId?: unknown
  version?: unknown
  description?: unknown
  weight?: unknown
  status?: unknown
}) {
  const projectId = parseJsonDecimalId(input.projectId, 'projectId')
  const version = typeof input.version === 'string' ? input.version.trim() : ''
  if (!version) throw new HttpError('Missing version', 400, 400)
  await requireActiveProject(projectId)

  const projectVersion = await prisma.projectVersion.create({
    data: {
      projectId,
      version,
      description:
        typeof input.description === 'string' ? input.description.trim() || null : null,
      weight: integerValue(input.weight, 0),
      status: 0,
    },
    include: { project: true },
  })
  return { ...projectVersionDto(projectVersion), isEmpty: await isProjectVersionEmpty(prisma, projectVersion.id) }
}

export async function getAdminProjectVersion(id: number) {
  const projectVersion = await prisma.projectVersion.findUnique({
    where: { id },
    include: { project: true },
  })
  if (!projectVersion) throw new HttpError('Not Found', 404, 404)
  return { ...projectVersionDto(projectVersion), isEmpty: await isProjectVersionEmpty(prisma, projectVersion.id) }
}

export async function updateAdminProjectVersion(
  id: number,
  input: {
    projectId?: unknown
    version?: unknown
    description?: unknown
    weight?: unknown
    status?: unknown
  },
) {
  // Publication identity fields are frozen; descriptions, weight and visibility remain editable.
  const data: Prisma.ProjectVersionUncheckedUpdateInput = { updatedAt: new Date() }
  if (input.projectId !== undefined) {
    const projectId = parseJsonDecimalId(input.projectId, 'projectId')
    await requireActiveProject(projectId)
    data.projectId = projectId
  }
  if (typeof input.version === 'string') {
    const version = input.version.trim()
    if (!version) throw new HttpError('Invalid version', 400, 400)
    data.version = version
  }
  if (input.description === null || typeof input.description === 'string') data.description = typeof input.description === 'string' ? input.description.trim() || null : null
  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  const requestedStatus = optionalIntegerValue(input.status)
  if (input.status !== undefined && requestedStatus !== 0 && requestedStatus !== 1) throw new HttpError('Invalid status', 400, 400)
  if (Object.keys(data).length === 1 && requestedStatus === null) throw new HttpError('No fields to update', 400, 400)

  try {
    const projectVersion = await executeVersionWrite(async (tx) => {
      await lockProjectVersionMetadata(tx, id)
      const current = await tx.projectVersion.findUniqueOrThrow({ where: { id } })
      if (current.publishedAt) {
        if (data.version !== undefined && data.version !== current.version) await lockDraftProjectVersions(tx, [id])
        if (data.projectId !== undefined && data.projectId !== current.projectId) {
          throw new HttpError('Published document membership is frozen', 409, 409, { reason: 'VERSION_FROZEN', projectVersionId: String(id) })
        }
        if (requestedStatus !== null) data.status = requestedStatus
      } else if (requestedStatus !== null && requestedStatus !== current.status) {
        throw new HttpError('Draft visibility cannot be changed', 409, 409, { reason: 'DRAFT_STATUS_IMMUTABLE' })
      }
      if (data.projectId !== undefined) {
        const target = await tx.project.findFirst({
          where: { id: data.projectId as number, isDeleted: false },
          select: { id: true },
        })
        if (!target) throw new HttpError('Project not found', 404, 404)
      }
      return tx.projectVersion.update({
        where: { id },
        data,
        include: { project: true },
      })
    })
    await invalidatePublicProjectCache(projectVersion.projectId)
    return { ...projectVersionDto(projectVersion), isEmpty: await isProjectVersionEmpty(prisma, projectVersion.id) }
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteAdminProjectVersion(id: number) {
  await deleteTrashItem('version', id)
  return projectVersionBaseDto(await prisma.projectVersion.findUniqueOrThrow({ where: { id } }))
}

export async function applyAdminProjectVersionBatch(input: {
  action?: unknown
  ids?: unknown
  status?: unknown
  projectId?: unknown
}) {
  const action = typeof input.action === 'string' ? input.action : ''
  const ids = parseJsonDecimalIds(input.ids)
  if (!action || !ids) throw new HttpError('Missing action or ids', 400, 400)

  const versions = await prisma.projectVersion.findMany({
    where: { id: { in: ids } },
    select: { id: true, publishedAt: true },
  })
  if (versions.length !== new Set(ids).size) throw new HttpError('Not Found', 404, 404)

  if (action === 'setStatus') {
    const status = optionalIntegerValue(input.status)
    if (status === null || (status !== 0 && status !== 1)) {
      throw new HttpError('Invalid status', 400, 400)
    }
    if (versions.some((version) => !version.publishedAt)) {
      throw new HttpError('Draft visibility cannot be changed', 409, 409, {
        reason: 'DRAFT_STATUS_IMMUTABLE',
      })
    }
    return setProjectVersionsVisibility(ids, status as 0 | 1)
  }

  if (versions.some((version) => version.publishedAt)) {
    throw new HttpError('Batch contains a frozen project version', 409, 409, {
      reason: 'VERSION_FROZEN',
    })
  }

  if (action === 'delete') {
    return deleteVersionBatch(ids)
  }
  if (action === 'moveToProject') {
    const projectId = parseJsonDecimalId(input.projectId, 'projectId')
    await requireActiveProject(projectId)
    return executeVersionWrite(async (tx) => {
      await lockDraftProjectVersions(tx, ids)
      const target = await tx.project.findFirst({
        where: { id: projectId, isDeleted: false },
        select: { id: true },
      })
      if (!target) throw new HttpError('Project not found', 404, 404)
      const result = await tx.projectVersion.updateMany({
        where: { id: { in: ids }, isDeleted: false },
        data: { projectId, updatedAt: new Date() },
      })
      return { count: result.count }
    })
  }
  throw new HttpError('Invalid action', 400, 400)
}

export async function listAdminProjectVersionsByProject(
  query: ProjectVersionByProjectQuery,
) {
  const project = await prisma.project.findUnique({ where: { id: query.projectId } })
  if (!project) throw new HttpError('Project not found', 404, 404)

  const where: Prisma.ProjectVersionWhereInput = { projectId: query.projectId, isDeleted: false, project: { isDeleted: false } }
  const [total, list] = await Promise.all([
    prisma.projectVersion.count({ where }),
    versionPage(where, query),
  ])

  const empty = await projectVersionEmptyStates(prisma, list.map(item => item.id))
  return {
    list: list.map(item => ({ ...projectVersionBaseDto(item), isEmpty: empty.get(item.id)! })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    ...(query.includeProjectInfo ? { project: projectSummaryDto(project) } : {}),
  }
}
