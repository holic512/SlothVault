/**
 * @file categories.ts
 * @project SlothVault
 * @module Admin Category Administration
 * @description Implements category listing, mutations, soft deletion, and project-version-scoped queries.
 * @logic Validate active parent versions, apply Prisma filters and mutations, and preserve existing DTO and error behavior.
 * @dependencies server/prisma, server/http/errors, catalog values, catalog DTOs
 * @index_tags admin,catalog,category,crud,project-version
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
} from './values'
import {
  categoryBaseDto,
  categoryDto,
  projectVersionBaseDto,
} from './dtos'
import type {
  CategoryByProjectVersionQuery,
  CategoryListQuery,
} from './query-types'

async function requireActiveProjectVersion(projectVersionId: number) {
  const projectVersion = await prisma.projectVersion.findFirst({
    where: { id: projectVersionId, isDeleted: false },
    select: { id: true },
  })
  if (!projectVersion) throw new HttpError('ProjectVersion not found', 404, 404)
}

export async function listAdminCategories(query: CategoryListQuery) {
  const where: Prisma.CategoryWhereInput = {}
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
  if (query.keyword) where.categoryName = databaseTextContains(query.keyword)
  if (Number.isFinite(query.status)) where.status = query.status
  if (query.projectVersionId !== undefined) where.projectVersionId = query.projectVersionId
  if (query.projectId !== undefined) where.projectVersion = { projectId: query.projectId }

  const [total, list] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
      include: query.includeProjectVersion
        ? { projectVersion: { include: { project: true } } }
        : undefined,
    }),
  ])
  return {
    list: list.map(categoryDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function createAdminCategory(input: {
  projectVersionId?: unknown
  categoryName?: unknown
  weight?: unknown
  status?: unknown
}) {
  const projectVersionId = parseJsonDecimalId(input.projectVersionId, 'projectVersionId')
  const categoryName = typeof input.categoryName === 'string' ? input.categoryName.trim() : ''
  if (!categoryName) throw new HttpError('Missing categoryName', 400, 400)
  await requireActiveProjectVersion(projectVersionId)

  const category = await prisma.category.create({
    data: {
      projectVersionId,
      categoryName,
      weight: integerValue(input.weight, 0),
      status: integerValue(input.status, 1),
    },
    include: { projectVersion: true },
  })
  return categoryDto(category)
}

export async function updateAdminCategory(
  id: number,
  input: {
    projectVersionId?: unknown
    categoryName?: unknown
    weight?: unknown
    status?: unknown
  },
) {
  const data: Prisma.CategoryUncheckedUpdateInput = { updatedAt: new Date() }
  if (input.projectVersionId !== undefined) {
    const projectVersionId = parseJsonDecimalId(input.projectVersionId, 'projectVersionId')
    await requireActiveProjectVersion(projectVersionId)
    data.projectVersionId = projectVersionId
  }
  if (typeof input.categoryName === 'string') {
    const categoryName = input.categoryName.trim()
    if (!categoryName) throw new HttpError('Invalid categoryName', 400, 400)
    data.categoryName = categoryName
  }
  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const category = await prisma.category.update({
      where: { id },
      data,
      include: { projectVersion: true },
    })
    return categoryDto(category)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteAdminCategory(id: number) {
  try {
    await prisma.category.update({
      where: { id },
      data: { isDeleted: true, updatedAt: new Date() },
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function listAdminCategoriesByProjectVersion(
  query: CategoryByProjectVersionQuery,
) {
  const projectVersion = await prisma.projectVersion.findUnique({
    where: { id: query.projectVersionId },
  })
  if (!projectVersion) throw new HttpError('ProjectVersion not found', 404, 404)

  const where: Prisma.CategoryWhereInput = { projectVersionId: query.projectVersionId }
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
  const [total, list] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
    }),
  ])

  return {
    list: list.map(categoryBaseDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    ...(query.includeProjectVersionInfo
      ? { projectVersion: projectVersionBaseDto(projectVersion) }
      : {}),
  }
}
