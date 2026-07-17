/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project API
 * @description Lists and creates projects for the authenticated administration catalog.
 * @logic Authenticate the request, apply legacy filters and pagination, then return stable project DTOs.
 * @dependencies admin session, HTTP route helpers, Prisma Project model, admin catalog service
 * @index_tags api,admin,project,list,create
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
  projectDto,
  projectListDto,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'

const createProjectSchema = z.object({
  projectName: z.unknown().optional(),
  avatar: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
  requireAuth: z.unknown().optional(),
})

const projectOrderFields = [
  'id',
  'projectName',
  'weight',
  'status',
  'requireAuth',
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
  const requireAuthRaw = searchParams.get('requireAuth')
  const requireAuth =
    requireAuthRaw === null ? undefined : legacyBoolean(requireAuthRaw)
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    projectOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  const where: Prisma.ProjectWhereInput = {}
  if (onlyDeleted) where.isDeleted = true
  else if (!includeDeleted) where.isDeleted = false
  if (keyword) where.projectName = { contains: keyword, mode: 'insensitive' }
  if (Number.isFinite(status)) where.status = status
  if (requireAuth !== undefined) where.requireAuth = requireAuth

  const [total, list] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
      include: {
        versions: {
          where: { isDeleted: false, status: 1 },
          orderBy: { weight: 'desc' },
          take: 1,
          include: {
            _count: {
              select: { categories: { where: { isDeleted: false } } },
            },
          },
        },
      },
    }),
  ])

  return apiOk({ list: list.map(projectListDto), page, pageSize, total })
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createProjectSchema)

  const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : ''
  if (!projectName) throw new HttpError('Missing projectName', 400, 400)

  const avatar = typeof body.avatar === 'string' ? body.avatar : null
  const weight = integerValue(body.weight, 0)
  const status = integerValue(body.status, 1)
  const requireAuth = typeof body.requireAuth === 'boolean' ? body.requireAuth : false

  const project = await prisma.project.create({
    data: { projectName, avatar, weight, status, requireAuth },
  })
  return apiOk(projectDto(project), 'created', 201)
})
