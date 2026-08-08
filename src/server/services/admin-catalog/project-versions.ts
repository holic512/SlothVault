/**
 * @file project-versions.ts
 * @project SlothVault
 * @module Admin Project Version Administration
 * @description Implements project-version listing, mutations, batch actions, and project-scoped queries.
 * @logic Validate active parent projects, apply Prisma mutations, and preserve existing response DTOs and error mapping.
 * @dependencies server/prisma, server/http/errors, catalog values, catalog DTOs
 * @index_tags admin,catalog,project-version,crud,batch
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

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
      status: integerValue(input.status, 1),
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
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const projectVersion = await prisma.projectVersion.update({
      where: { id },
      data,
      include: { project: true },
    })
    return projectVersionDto(projectVersion)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteAdminProjectVersion(id: number) {
  try {
    const projectVersion = await prisma.projectVersion.update({
      where: { id },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
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

  if (action === 'delete') {
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  if (action === 'restore') {
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: false, status: 1, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  if (action === 'setStatus') {
    const status = optionalIntegerValue(input.status)
    if (status === null) throw new HttpError('Missing status', 400, 400)
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { status, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  if (action === 'moveToProject') {
    const projectId = parseJsonDecimalId(input.projectId, 'projectId')
    await requireActiveProject(projectId)
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { projectId, updatedAt: new Date() },
    })
    return { count: result.count }
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
