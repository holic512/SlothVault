/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Category API
 * @description Lists and creates documentation categories for authenticated administrators.
 * @logic Preserve legacy filters and optional relation expansion, validate the parent version, and return stable category DTOs.
 * @dependencies admin session, HTTP route helpers, Prisma Category model, admin catalog service
 * @index_tags api,admin,category,list,create
 * @author holic512
 */
import type { Prisma } from '@generated/prisma/client'
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  categoryDto,
  integerValue,
  legacyBoolean,
  pagination,
  parseDecimalId,
  parseJsonDecimalId,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'

const createCategorySchema = z.object({
  projectVersionId: z.unknown().optional(),
  categoryName: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

const categoryOrderFields = [
  'id',
  'categoryName',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
] as const

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)

  const searchParams = request.nextUrl.searchParams
  const { page, pageSize, skip } = pagination(searchParams)
  const keyword = searchParams.get('keyword')?.trim() || ''
  const includeDeleted = legacyBoolean(searchParams.get('includeDeleted'))
  const onlyDeleted = legacyBoolean(searchParams.get('onlyDeleted'))
  const includeProjectVersion = legacyBoolean(searchParams.get('includeProjectVersion'))
  const statusRaw = searchParams.get('status')
  const status = statusRaw === null ? undefined : integerValue(statusRaw, Number.NaN)
  const projectVersionIdRaw = searchParams.get('projectVersionId')
  const projectIdRaw = searchParams.get('projectId')
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    categoryOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  const where: Prisma.CategoryWhereInput = {}
  if (onlyDeleted) where.isDeleted = true
  else if (!includeDeleted) where.isDeleted = false
  if (keyword) where.categoryName = { contains: keyword, mode: 'insensitive' }
  if (Number.isFinite(status)) where.status = status
  if (projectVersionIdRaw !== null) {
    where.projectVersionId = parseDecimalId(projectVersionIdRaw, 'projectVersionId')
  }
  if (projectIdRaw !== null) {
    where.projectVersion = { projectId: parseDecimalId(projectIdRaw, 'projectId') }
  }

  const [total, list] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
      include: includeProjectVersion
        ? { projectVersion: { include: { project: true } } }
        : undefined,
    }),
  ])

  return apiOk({ list: list.map(categoryDto), page, pageSize, total })
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createCategorySchema)
  const projectVersionId = parseJsonDecimalId(body.projectVersionId, 'projectVersionId')
  const categoryName = typeof body.categoryName === 'string' ? body.categoryName.trim() : ''
  if (!categoryName) throw new HttpError('Missing categoryName', 400, 400)

  const projectVersion = await prisma.projectVersion.findFirst({
    where: { id: projectVersionId, isDeleted: false },
  })
  if (!projectVersion) throw new HttpError('ProjectVersion not found', 404, 404)

  const category = await prisma.category.create({
    data: {
      projectVersionId,
      categoryName,
      weight: integerValue(body.weight, 0),
      status: integerValue(body.status, 1),
    },
    include: { projectVersion: true },
  })
  return apiOk(categoryDto(category), 'created', 201)
})
