/**
 * @file projects.ts
 * @project SlothVault
 * @module Admin Project Administration
 * @description Implements project listing, creation, lookup, updates, soft deletion, and batch actions.
 * @logic Build Prisma filters, keep projects publicly readable, map stable DTOs, and translate missing records consistently.
 * @dependencies server/prisma, server/http/errors, catalog values, catalog DTOs
 * @index_tags admin,catalog,project,crud,batch
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'

import {
  databaseTextContains,
  hasPrismaCode,
  integerValue,
  optionalIntegerValue,
  parseJsonDecimalIds,
} from './values'
import { projectDto, projectListDto, projectSummaryDto } from './dtos'
import type { ProjectListQuery } from './query-types'

export async function listAdminProjects(query: ProjectListQuery) {
  const where: Prisma.ProjectWhereInput = {}
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
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
        versions: {
          where: {
            isDeleted: false,
            status: 1,
            publishedAt: { not: null },
            releaseId: { not: null },
            releaseHash: { not: null },
            manifestVersion: 1,
          },
          orderBy: { weight: 'desc' },
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
}) {
  const projectName = typeof input.projectName === 'string' ? input.projectName.trim() : ''
  if (!projectName) throw new HttpError('Missing projectName', 400, 400)

  const project = await prisma.project.create({
    data: {
      projectName,
      avatar: typeof input.avatar === 'string' ? input.avatar : null,
      weight: integerValue(input.weight, 0),
      status: integerValue(input.status, 1),
      requireAuth: false,
    },
  })
  return projectDto(project)
}

export async function getAdminProject(id: number) {
  const project = await prisma.project.findUnique({ where: { id } })
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

  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const project = await prisma.project.update({ where: { id }, data })
    if (data.status !== undefined) await invalidatePublicProjectCache(id)
    return projectDto(project)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteAdminProject(id: number) {
  try {
    const project = await prisma.project.update({
      where: { id },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    await invalidatePublicProjectCache(id)
    return projectSummaryDto(project)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
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
    const result = await prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    await Promise.all(ids.map((id) => invalidatePublicProjectCache(id)))
    return { count: result.count }
  }
  if (action === 'restore') {
    const result = await prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: false, status: 1, updatedAt: new Date() },
    })
    await Promise.all(ids.map((id) => invalidatePublicProjectCache(id)))
    return { count: result.count }
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
