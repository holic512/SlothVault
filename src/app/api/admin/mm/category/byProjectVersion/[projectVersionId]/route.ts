/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Category API
 * @description Lists categories belonging to one project version with optional version metadata.
 * @logic Authenticate and parse the version-scoped legacy query before delegating the paginated lookup to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,category,project-version-filter,list
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  legacyBoolean,
  listAdminCategoriesByProjectVersion,
  pagination,
  parseDecimalId,
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

  return apiOk(
    await listAdminCategoriesByProjectVersion({
      projectVersionId,
      page,
      pageSize,
      skip,
      includeDeleted,
      onlyDeleted,
      includeProjectVersionInfo,
      orderByField,
      order,
    }),
  )
})
