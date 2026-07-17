/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Category API
 * @description Lists categories belonging to one project version with optional version metadata.
 * @logic Authenticate, validate the version path ID, preserve legacy filters, and return paginated category DTOs.
 * @dependencies admin session, HTTP route helpers, Prisma Category model, admin catalog service
 * @index_tags api,admin,category,project-version-filter,list
 * @author holic512
 */
import type { Prisma } from '@generated/prisma/client'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  categoryBaseDto,
  legacyBoolean,
  pagination,
  parseDecimalId,
  projectVersionBaseDto,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'

const categoryOrderFields = [
  'id',
  'categoryName',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
] as const

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ projectVersionId: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { projectVersionId: projectVersionIdRaw } = await context.params
  const projectVersionId = parseDecimalId(projectVersionIdRaw, 'projectVersionId')
  const searchParams = request.nextUrl.searchParams
  const { page, pageSize, skip } = pagination(searchParams)
  const includeDeleted = legacyBoolean(searchParams.get('includeDeleted'))
  const onlyDeleted = legacyBoolean(searchParams.get('onlyDeleted'))
  const includeProjectVersionInfo = legacyBoolean(
    searchParams.get('includeProjectVersionInfo'),
  )
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    categoryOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  const projectVersion = await prisma.projectVersion.findUnique({
    where: { id: projectVersionId },
  })
  if (!projectVersion) throw new HttpError('ProjectVersion not found', 404, 404)

  const where: Prisma.CategoryWhereInput = { projectVersionId }
  if (onlyDeleted) where.isDeleted = true
  else if (!includeDeleted) where.isDeleted = false

  const [total, list] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
    }),
  ])

  return apiOk({
    list: list.map(categoryBaseDto),
    page,
    pageSize,
    total,
    ...(includeProjectVersionInfo
      ? { projectVersion: projectVersionBaseDto(projectVersion) }
      : {}),
  })
})
