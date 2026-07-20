/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Lists and creates project versions for authenticated administrators.
 * @logic Authenticate and parse legacy query/body inputs, then delegate version reads and writes to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project-version,list,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  createAdminProjectVersion,
  integerValue,
  legacyBoolean,
  listAdminProjectVersions,
  pagination,
  parseDecimalId,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'

const createProjectVersionSchema = z.object({
  projectId: z.unknown().optional(),
  version: z.unknown().optional(),
  description: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

const projectVersionOrderFields = [
  'id',
  'version',
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
  const includeProject = legacyBoolean(searchParams.get('includeProject'))
  const statusRaw = searchParams.get('status')
  const status = statusRaw === null ? undefined : integerValue(statusRaw, Number.NaN)
  const projectIdRaw = searchParams.get('projectId')
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    projectVersionOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  return apiOk(
    await listAdminProjectVersions({
      page,
      pageSize,
      skip,
      keyword,
      includeDeleted,
      onlyDeleted,
      includeProject,
      status,
      projectId:
        projectIdRaw === null ? undefined : parseDecimalId(projectIdRaw, 'projectId'),
      orderByField,
      order,
    }),
  )
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createProjectVersionSchema)
  return apiOk(await createAdminProjectVersion(body), 'created', 201)
})
