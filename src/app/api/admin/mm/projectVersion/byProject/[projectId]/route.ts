/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Lists versions belonging to one project with optional project metadata.
 * @logic Authenticate and parse the project-scoped legacy query before delegating the paginated lookup to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project-version,project-filter,list
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  legacyBoolean,
  listAdminProjectVersionsByProject,
  pagination,
  parseDecimalId,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'

const projectVersionOrderFields = [
  'id',
  'version',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
] as const

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ projectId: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { projectId: projectIdRaw } = await context.params
  const projectId = parseDecimalId(projectIdRaw, 'projectId')
  const searchParams = request.nextUrl.searchParams
  const { page, pageSize, skip } = pagination(searchParams)
  const includeDeleted = legacyBoolean(searchParams.get('includeDeleted'))
  const onlyDeleted = legacyBoolean(searchParams.get('onlyDeleted'))
  const includeProjectInfo = legacyBoolean(searchParams.get('includeProjectInfo'))
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    projectVersionOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  return apiOk(
    await listAdminProjectVersionsByProject({
      projectId,
      page,
      pageSize,
      skip,
      includeDeleted,
      onlyDeleted,
      includeProjectInfo,
      orderByField,
      order,
    }),
  )
})
