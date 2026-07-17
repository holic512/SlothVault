/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note API
 * @description Lists and creates note metadata for authenticated administrators.
 * @logic Preserve legacy filters and relation expansion, validate active category parents, and return stable note DTOs.
 * @dependencies admin session, HTTP route helpers, Prisma NoteInfo model, admin notes service
 * @index_tags api,admin,note,list,create
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
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'
import { noteDto, requireActiveCategory } from '@/server/services/admin-notes'

const createNoteSchema = z.object({
  categoryId: z.unknown().optional(),
  noteTitle: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

const noteOrderFields = [
  'id',
  'noteTitle',
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
  const categoryIdRaw = searchParams.get('categoryId')
  const projectVersionIdRaw = searchParams.get('projectVersionId')
  const projectIdRaw = searchParams.get('projectId')
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    noteOrderFields,
    'weight',
  )
  const order = sortDirection(searchParams.get('order'))

  const where: Prisma.NoteInfoWhereInput = {}
  if (onlyDeleted) where.isDeleted = true
  else if (!includeDeleted) where.isDeleted = false
  if (keyword) where.noteTitle = { contains: keyword, mode: 'insensitive' }
  if (Number.isFinite(status)) where.status = status
  if (categoryIdRaw !== null) where.categoryId = parseDecimalId(categoryIdRaw, 'categoryId')

  const categoryWhere: Prisma.CategoryWhereInput = {}
  if (projectVersionIdRaw !== null) {
    categoryWhere.projectVersionId = parseDecimalId(
      projectVersionIdRaw,
      'projectVersionId',
    )
  }
  if (projectIdRaw !== null) {
    categoryWhere.projectVersion = {
      projectId: parseDecimalId(projectIdRaw, 'projectId'),
    }
  }
  if (Object.keys(categoryWhere).length > 0) where.category = categoryWhere

  const [total, list] = await Promise.all([
    prisma.noteInfo.count({ where }),
    prisma.noteInfo.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
      include: {
        category: {
          include: {
            projectVersion: { include: { project: true } },
          },
        },
        _count: { select: { contents: true } },
      },
    }),
  ])

  return apiOk({ list: list.map(noteDto), page, pageSize, total })
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createNoteSchema)
  const categoryId = parseJsonDecimalId(body.categoryId, 'categoryId')
  const noteTitle = typeof body.noteTitle === 'string' ? body.noteTitle.trim() : ''
  if (!noteTitle) throw new HttpError('Missing noteTitle', 400, 400)

  await requireActiveCategory(categoryId)
  const note = await prisma.noteInfo.create({
    data: {
      categoryId,
      noteTitle,
      weight: integerValue(body.weight, 0),
      status: integerValue(body.status, 1),
    },
    include: { category: true },
  })
  return apiOk(noteDto(note), 'created', 201)
})
