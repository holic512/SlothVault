/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project API
 * @description Lists and creates projects for the authenticated administration catalog.
 * @logic Authenticate and parse legacy query/body inputs, then delegate project reads and writes to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project,list,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  createAdminProject,
  integerValue,
  legacyBoolean,
  listAdminProjects,
  pagination,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'

const createProjectSchema = z.object({
  projectName: z.unknown().optional(),
  avatar: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

const projectOrderFields = [
  'id',
  'projectName',
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
  const statusRaw = searchParams.get('status')
  const status = statusRaw === null ? undefined : integerValue(statusRaw, Number.NaN)
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    projectOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  return apiOk(
    await listAdminProjects({
      page,
      pageSize,
      skip,
      keyword,
      includeDeleted,
      onlyDeleted,
      status,
      orderByField,
      order,
    }),
  )
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createProjectSchema)
  return apiOk(await createAdminProject(body), 'created', 201)
})
