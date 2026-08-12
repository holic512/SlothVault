/**
 * @file project-versions.ts
 * @project SlothVault
 * @module Admin Project Version Administration
 * @description Implements draft project-version listing, mutations, batch actions, and project-scoped queries around immutable releases.
 * @logic Normalize new versions to drafts, serialize mutable writes through the version lock, route published visibility changes through the release service, and reject mixed frozen batches atomically.
 * @dependencies server/prisma, server/http/errors, catalog values, catalog DTOs, project-version release service
 * @index_tags admin,catalog,project-version,crud,batch
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  executeVersionWrite,
  lockDraftProjectVersions,
  setProjectVersionVisibility,
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

export async function listAdminProjectVersions(query: ProjectVersionListQuery) {
  const where: Prisma.ProjectVersionWhereInput = {}
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
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
    prisma.projectVersion.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
      include: query.includeProject ? { project: true } : undefined,
    }),
  ])
  return {
    list: list.map(projectVersionDto),
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
  return projectVersionDto(projectVersion)
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
  const current = await prisma.projectVersion.findUnique({
    where: { id },
    select: { publishedAt: true },
  })
  if (!current) throw new HttpError('Not Found', 404, 404)

  const requestedStatus = optionalIntegerValue(input.status)
  const changesContent =
    input.projectId !== undefined ||
    input.version !== undefined ||
    input.description !== undefined ||
    input.weight !== undefined
  if (current.publishedAt) {
    if (changesContent || requestedStatus === null || (requestedStatus !== 0 && requestedStatus !== 1)) {
      throw new HttpError('Published project version is frozen', 409, 409, {
        reason: 'VERSION_FROZEN',
        projectVersionId: String(id),
      })
    }
    return setProjectVersionVisibility(id, requestedStatus as 0 | 1)
  }
  if (input.status !== undefined) {
    throw new HttpError('Draft visibility cannot be changed', 409, 409, {
      reason: 'DRAFT_STATUS_IMMUTABLE',
    })
  }

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
  if (typeof input.description === 'string') data.description = input.description.trim() || null
  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const projectVersion = await executeVersionWrite(async (tx) => {
      await lockDraftProjectVersions(tx, [id])
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
    return projectVersionDto(projectVersion)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteAdminProjectVersion(id: number) {
  try {
    const projectVersion = await executeVersionWrite(async (tx) => {
      await lockDraftProjectVersions(tx, [id])
      return tx.projectVersion.update({
        where: { id },
        data: { isDeleted: true, status: 0, updatedAt: new Date() },
      })
    })
    return projectVersionBaseDto(projectVersion)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
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
    return executeVersionWrite(async (tx) => {
      await lockDraftProjectVersions(tx, ids)
      const result = await tx.projectVersion.updateMany({
        where: { id: { in: ids } },
        data: { isDeleted: true, status: 0, updatedAt: new Date() },
      })
      return { count: result.count }
    })
  }
  if (action === 'restore') {
    return executeVersionWrite(async (tx) => {
      const locked = await tx.projectVersion.updateMany({
        where: { id: { in: ids }, publishedAt: null },
        data: { documentRevision: { increment: 1 }, updatedAt: new Date() },
      })
      if (locked.count !== ids.length) {
        throw new HttpError('Batch contains a frozen project version', 409, 409, {
          reason: 'VERSION_FROZEN',
        })
      }
      const result = await tx.projectVersion.updateMany({
        where: { id: { in: ids }, publishedAt: null },
        data: { isDeleted: false, status: 0, updatedAt: new Date() },
      })
      return { count: result.count }
    })
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

  const where: Prisma.ProjectVersionWhereInput = { projectId: query.projectId }
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
  const [total, list] = await Promise.all([
    prisma.projectVersion.count({ where }),
    prisma.projectVersion.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
    }),
  ])

  return {
    list: list.map(projectVersionBaseDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    ...(query.includeProjectInfo ? { project: projectSummaryDto(project) } : {}),
  }
}
