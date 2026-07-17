/**
 * @file route.ts
 * @project SlothVault
 * @module Admin File API
 * @description Reads, reclassifies, soft-deletes, or safely hard-deletes one managed file.
 * @logic Authenticate, validate decimal IDs and business types, preserve file URLs when metadata changes, and delegate compensating disk deletion to the file service.
 * @dependencies admin session, HTTP route helpers, Prisma FileManagement model, admin file storage service
 * @index_tags api,admin,files,detail,update,soft-delete,hard-delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  legacyBoolean,
  parseDecimalId,
} from '@/server/services/admin-catalog'
import {
  fileDto,
  hardDeleteFile,
  isBusinessType,
  softDeleteFile,
  updateFileBusinessType,
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
  const file = await prisma.fileManagement.findUnique({ where: { id } })
  if (!file) throw new HttpError('Not Found', 404, 404)
  return apiOk(fileDto(file))
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

  const file = await updateFileBusinessType(id, body.businessType)
  return apiOk(fileDto(file))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const hard = legacyBoolean(request.nextUrl.searchParams.get('hard'))

  if (hard) await hardDeleteFile(id)
  else await softDeleteFile(id)
  return apiOk(null, 'deleted')
})
