/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Category API
 * @description Lists and creates documentation categories for authenticated administrators.
 * @logic Authenticate and parse legacy query/body inputs, then delegate category reads and writes to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,category,list,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  createAdminCategory,
  integerValue,
  legacyBoolean,
  listAdminCategories,
  pagination,
  parseDecimalId,
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

  return apiOk(
    await listAdminCategories({
      page,
      pageSize,
      skip,
      keyword,
      includeDeleted,
      onlyDeleted,
      includeProjectVersion,
      status,
      projectVersionId:
        projectVersionIdRaw === null
          ? undefined
          : parseDecimalId(projectVersionIdRaw, 'projectVersionId'),
      projectId:
        projectIdRaw === null ? undefined : parseDecimalId(projectIdRaw, 'projectId'),
      orderByField,
      order,
    }),
  )
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createCategorySchema)
  return apiOk(await createAdminCategory(body), 'created', 201)
})
