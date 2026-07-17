/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Lists versions belonging to one project with optional project metadata.
 * @logic Authenticate, validate the project path ID, preserve legacy filters, and return paginated version DTOs.
 * @dependencies admin session, HTTP route helpers, Prisma ProjectVersion model, admin catalog service
 * @index_tags api,admin,project-version,project-filter,list
 * @author holic512
 */
import type { Prisma } from '@generated/prisma/client'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  legacyBoolean,
  pagination,
  parseDecimalId,
  projectSummaryDto,
  projectVersionBaseDto,
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

  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) throw new HttpError('Project not found', 404, 404)

  const where: Prisma.ProjectVersionWhereInput = { projectId }
  if (onlyDeleted) where.isDeleted = true
  else if (!includeDeleted) where.isDeleted = false

  const [total, list] = await Promise.all([
    prisma.projectVersion.count({ where }),
    prisma.projectVersion.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
    }),
  ])

  return apiOk({
    list: list.map(projectVersionBaseDto),
    page,
    pageSize,
    total,
    ...(includeProjectInfo ? { project: projectSummaryDto(project) } : {}),
  })
})
