/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note API
 * @description Lists and creates note metadata for authenticated administrators.
 * @logic Authenticate and parse legacy query/body inputs, then delegate note metadata reads and writes to the notes service.
 * @dependencies admin session, HTTP route helpers, admin catalog parsing, admin notes service
 * @index_tags api,admin,note,list,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  integerValue,
  legacyBoolean,
  pagination,
  parseDecimalId,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'
import { createAdminNote, listAdminNotes } from '@/server/services/admin-notes'

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

  return apiOk(
    await listAdminNotes({
      page,
      pageSize,
      skip,
      keyword,
      includeDeleted,
      onlyDeleted,
      status,
      categoryId:
        categoryIdRaw === null ? undefined : parseDecimalId(categoryIdRaw, 'categoryId'),
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
  const session = await requireAdminSession(request)
  const body = await readJson(request, createNoteSchema)
  return apiOk(await createAdminNote({ ...body, authorId: session.userId }), 'created', 201)
})
