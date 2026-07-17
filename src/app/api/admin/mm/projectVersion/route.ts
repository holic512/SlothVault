/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Lists and creates project versions for authenticated administrators.
 * @logic Apply legacy filters and pagination, validate the parent project, and return stable version DTOs.
 * @dependencies admin session, HTTP route helpers, Prisma ProjectVersion model, admin catalog service
 * @index_tags api,admin,project-version,list,create
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
  integerValue,
  legacyBoolean,
  pagination,
  parseDecimalId,
  parseJsonDecimalId,
  projectVersionDto,
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

  const where: Prisma.ProjectVersionWhereInput = {}
  if (onlyDeleted) where.isDeleted = true
  else if (!includeDeleted) where.isDeleted = false
  if (keyword) {
    where.OR = [
      { version: { contains: keyword, mode: 'insensitive' } },
      { description: { contains: keyword, mode: 'insensitive' } },
    ]
  }
  if (Number.isFinite(status)) where.status = status
  if (projectIdRaw !== null) where.projectId = parseDecimalId(projectIdRaw, 'projectId')

  const [total, list] = await Promise.all([
    prisma.projectVersion.count({ where }),
    prisma.projectVersion.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
      include: includeProject ? { project: true } : undefined,
    }),
  ])

  return apiOk({ list: list.map(projectVersionDto), page, pageSize, total })
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createProjectVersionSchema)
  const projectId = parseJsonDecimalId(body.projectId, 'projectId')
  const version = typeof body.version === 'string' ? body.version.trim() : ''
  if (!version) throw new HttpError('Missing version', 400, 400)

  const project = await prisma.project.findFirst({
    where: { id: projectId, isDeleted: false },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)

  const projectVersion = await prisma.projectVersion.create({
    data: {
      projectId,
      version,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      weight: integerValue(body.weight, 0),
      status: integerValue(body.status, 1),
    },
    include: { project: true },
  })
  return apiOk(projectVersionDto(projectVersion), 'created', 201)
})
