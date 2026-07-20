/**
 * @file admin-catalog.ts
 * @project SlothVault
 * @module Admin Catalog
 * @description Owns project, version, and category administration queries together with shared parsing and stable DTO mapping.
 * @logic Normalize legacy request values, build provider-portable filters, validate active parent records, execute catalog mutations, and serialize decimal identifiers without exposing Prisma to route handlers.
 * @dependencies server/prisma, server/database/client, server/http/errors, Prisma project catalog models
 * @index_tags admin,project,project-version,category,service,dto,validation
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { configuredDatabaseProvider } from '@/server/database/client'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

const DECIMAL_ID_PATTERN = /^\d+$/

type ProjectLike = {
  id: number
  projectName: string
  avatar: string | null
  weight: number
  status: number
  requireAuth: boolean
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

type ProjectVersionLike = {
  id: number
  projectId: number
  version: string
  description: string | null
  weight: number
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  project?: Pick<ProjectLike, 'id' | 'projectName'> | null
}

type CategoryLike = {
  id: number
  projectVersionId: number
  categoryName: string
  weight: number
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  projectVersion?:
    | (Pick<ProjectVersionLike, 'id' | 'projectId' | 'version'> & {
        project?: Pick<ProjectLike, 'id' | 'projectName'> | null
      })
    | null
}

const MAX_DATABASE_ID = 2_147_483_647

export function parseDecimalId(value: string | undefined, label = 'id'): number {
  if (value === undefined) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }
  if (!DECIMAL_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_DATABASE_ID) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return id
}

export function parseJsonDecimalId(value: unknown, label: string): number {
  if (value === undefined) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }
  if (typeof value !== 'string' || !DECIMAL_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return parseDecimalId(value, label)
}

export function parseJsonDecimalIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const ids: number[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !DECIMAL_ID_PATTERN.test(item)) return null
    const id = Number(item)
    if (!Number.isSafeInteger(id) || id < 1 || id > MAX_DATABASE_ID) return null
    ids.push(id)
  }
  return ids
}

export function integerValue(value: unknown, fallback: number): number {
  const numberValue =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback
}

export function optionalIntegerValue(value: unknown): number | null {
  const numberValue =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null
}

export function legacyBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return value === '1' || value.toLowerCase() === 'true'
}

export function optionalLegacyBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  return null
}

export function pagination(searchParams: URLSearchParams) {
  const page = Math.max(1, integerValue(searchParams.get('page'), 1))
  const pageSize = Math.min(100, Math.max(1, integerValue(searchParams.get('pageSize'), 10)))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

export function sortDirection(value: string | null): 'asc' | 'desc' {
  return value?.toLowerCase() === 'asc' ? 'asc' : 'desc'
}

export function safeOrderField<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value && allowed.includes(value as T) ? (value as T) : fallback
}

export function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

export function databaseTextContains(value: string): Prisma.StringFilter {
  return configuredDatabaseProvider() === 'postgresql'
    ? { contains: value, mode: 'insensitive' }
    : { contains: value }
}

export function projectDto(project: ProjectLike) {
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    avatar: project.avatar,
    weight: project.weight,
    status: project.status,
    requireAuth: project.requireAuth,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    isDeleted: project.isDeleted,
  }
}

export function projectSummaryDto(project: ProjectLike) {
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    weight: project.weight,
    status: project.status,
    requireAuth: project.requireAuth,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    isDeleted: project.isDeleted,
  }
}

export function projectListDto(
  project: ProjectLike & {
    versions?: Array<{
      id: number
      version: string
      isDeleted: boolean
      _count?: { categories: number }
    }>
  },
) {
  const latestVersion = project.versions?.find((version) => !version.isDeleted)
  return {
    ...projectDto(project),
    latestVersion: latestVersion?.version || null,
    latestVersionId: latestVersion?.id.toString() || null,
    categoryCount: latestVersion?._count?.categories ?? 0,
  }
}

export function projectVersionBaseDto(projectVersion: ProjectVersionLike) {
  return {
    id: projectVersion.id.toString(),
    projectId: projectVersion.projectId.toString(),
    version: projectVersion.version,
    description: projectVersion.description,
    weight: projectVersion.weight,
    status: projectVersion.status,
    createdAt: projectVersion.createdAt,
    updatedAt: projectVersion.updatedAt,
    isDeleted: projectVersion.isDeleted,
  }
}

export function projectVersionDto(projectVersion: ProjectVersionLike) {
  return {
    ...projectVersionBaseDto(projectVersion),
    project: projectVersion.project
      ? {
          id: projectVersion.project.id.toString(),
          projectName: projectVersion.project.projectName,
        }
      : null,
  }
}

export function categoryBaseDto(category: CategoryLike) {
  return {
    id: category.id.toString(),
    projectVersionId: category.projectVersionId.toString(),
    categoryName: category.categoryName,
    weight: category.weight,
    status: category.status,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    isDeleted: category.isDeleted,
  }
}

export function categoryDto(category: CategoryLike) {
  const projectVersion = category.projectVersion
  return {
    ...categoryBaseDto(category),
    projectVersion: projectVersion
      ? {
          id: projectVersion.id.toString(),
          version: projectVersion.version,
          projectId: projectVersion.projectId.toString(),
          ...(projectVersion.project !== undefined
            ? {
                project: projectVersion.project
                  ? {
                      id: projectVersion.project.id.toString(),
                      projectName: projectVersion.project.projectName,
                    }
                  : null,
              }
            : {}),
        }
      : null,
  }
}

type ProjectOrderField =
  | 'id'
  | 'projectName'
  | 'weight'
  | 'status'
  | 'requireAuth'
  | 'createdAt'
  | 'updatedAt'

type ProjectVersionOrderField =
  | 'id'
  | 'version'
  | 'weight'
  | 'status'
  | 'createdAt'
  | 'updatedAt'

type CategoryOrderField =
  | 'id'
  | 'categoryName'
  | 'weight'
  | 'status'
  | 'createdAt'
  | 'updatedAt'

type PageQuery<TOrderField extends string> = {
  page: number
  pageSize: number
  skip: number
  orderByField: TOrderField
  order: 'asc' | 'desc'
}

export type ProjectListQuery = PageQuery<ProjectOrderField> & {
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  status?: number
  requireAuth?: boolean
}

export type ProjectVersionListQuery = PageQuery<ProjectVersionOrderField> & {
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProject: boolean
  status?: number
  projectId?: number
}

export type ProjectVersionByProjectQuery = PageQuery<ProjectVersionOrderField> & {
  projectId: number
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProjectInfo: boolean
}

export type CategoryListQuery = PageQuery<CategoryOrderField> & {
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProjectVersion: boolean
  status?: number
  projectVersionId?: number
  projectId?: number
}

export type CategoryByProjectVersionQuery = PageQuery<CategoryOrderField> & {
  projectVersionId: number
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProjectVersionInfo: boolean
}

export async function listAdminProjects(query: ProjectListQuery) {
  const where: Prisma.ProjectWhereInput = {}
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
  if (query.keyword) where.projectName = databaseTextContains(query.keyword)
  if (Number.isFinite(query.status)) where.status = query.status
  if (query.requireAuth !== undefined) where.requireAuth = query.requireAuth

  const [total, list] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
      include: {
        versions: {
          where: { isDeleted: false, status: 1 },
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
  requireAuth?: unknown
}) {
  const projectName = typeof input.projectName === 'string' ? input.projectName.trim() : ''
  if (!projectName) throw new HttpError('Missing projectName', 400, 400)

  const project = await prisma.project.create({
    data: {
      projectName,
      avatar: typeof input.avatar === 'string' ? input.avatar : null,
      weight: integerValue(input.weight, 0),
      status: integerValue(input.status, 1),
      requireAuth: typeof input.requireAuth === 'boolean' ? input.requireAuth : false,
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
    requireAuth?: unknown
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
  if (typeof input.requireAuth === 'boolean') data.requireAuth = input.requireAuth
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    return projectDto(await prisma.project.update({ where: { id }, data }))
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
  requireAuth?: unknown
}) {
  const action = typeof input.action === 'string' ? input.action : ''
  const ids = parseJsonDecimalIds(input.ids)
  if (!action || !ids) throw new HttpError('Missing action or ids', 400, 400)

  if (action === 'delete') {
    const result = await prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  if (action === 'restore') {
    const result = await prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: false, status: 1, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  if (action === 'setStatus') {
    const status = optionalIntegerValue(input.status)
    if (status === null) throw new HttpError('Missing status', 400, 400)
    const result = await prisma.project.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { status, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  if (action === 'setRequireAuth') {
    const requireAuth = optionalLegacyBoolean(input.requireAuth)
    if (requireAuth === null) throw new HttpError('Missing requireAuth', 400, 400)
    const result = await prisma.project.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { requireAuth, updatedAt: new Date() },
    })
    return { count: result.count }
  }
  throw new HttpError('Invalid action', 400, 400)
}

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
