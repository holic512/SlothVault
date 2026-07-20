/**
 * @file route.ts
 * @project SlothVault
 * @module Admin File API
 * @description Reads, reclassifies, soft-deletes, or safely hard-deletes one managed file.
 * @logic Authenticate and parse route/body inputs, then delegate metadata reads, reclassification, and compensating deletion to the file service.
 * @dependencies admin session, HTTP route helpers, admin catalog parsing, admin file storage service
 * @index_tags api,admin,files,detail,update,soft-delete,hard-delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  legacyBoolean,
  parseDecimalId,
} from '@/server/services/admin-catalog'
import {
  deleteAdminFile,
  getAdminFile,
  isBusinessType,
  updateAdminFileBusinessType,
} from '@/server/services/admin-files'

const updateFileSchema = z.object({
  businessType: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  return apiOk(await getAdminFile(id))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateFileSchema)

  if (body.businessType === undefined) {
    throw new HttpError('No fields to update', 400, 400)
  }
  if (!isBusinessType(body.businessType)) {
    throw new HttpError('Invalid businessType', 400, 400)
  }

  return apiOk(await updateAdminFileBusinessType(id, body.businessType))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const hard = legacyBoolean(request.nextUrl.searchParams.get('hard'))

  await deleteAdminFile(id, hard)
  return apiOk(null, 'deleted')
})
