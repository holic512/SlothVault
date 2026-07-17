/**
 * @file admin-catalog.ts
 * @project SlothVault
 * @module Admin Catalog
 * @description Provides shared parsing, DTO mapping, and Prisma error helpers for project catalog administration APIs.
 * @logic Validate decimal identifiers, normalize legacy pagination/filter inputs, and preserve stable project/version/category response shapes.
 * @dependencies server/http/errors, Prisma project catalog models
 * @index_tags admin,project,project-version,category,dto,validation
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'

const DECIMAL_ID_PATTERN = /^\d+$/

type ProjectLike = {
  id: bigint
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
  id: bigint
  projectId: bigint
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
  id: bigint
  projectVersionId: bigint
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

export function parseDecimalId(value: string | undefined, label = 'id'): bigint {
  if (value === undefined) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }
  if (!DECIMAL_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return BigInt(value)
}

export function parseJsonDecimalId(value: unknown, label: string): bigint {
  if (value === undefined) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }
  if (typeof value !== 'string' || !DECIMAL_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return BigInt(value)
}

export function parseJsonDecimalIds(value: unknown): bigint[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const ids: bigint[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !DECIMAL_ID_PATTERN.test(item)) return null
    ids.push(BigInt(item))
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
      id: bigint
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
