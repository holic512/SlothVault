/**
 * @file route.ts
 * @project SlothVault
 * @module Admin File Batch API
 * @description Applies the legacy batch soft-delete action to managed files.
 * @logic Authenticate and parse a supported decimal-ID batch request, then delegate the soft-delete update to the file service.
 * @dependencies admin session, HTTP route helpers, admin catalog ID parsing, admin file storage service
 * @index_tags api,admin,files,batch,soft-delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseJsonDecimalIds } from '@/server/services/admin-catalog'
import { batchDeleteAdminFiles } from '@/server/services/admin-files'

const batchFileSchema = z.object({
  action: z.unknown().optional(),
  ids: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, batchFileSchema)
  if (!body.action || !Array.isArray(body.ids) || body.ids.length === 0) {
    throw new HttpError('Missing action or ids', 400, 400)
  }

  const ids = parseJsonDecimalIds(body.ids)
  if (!ids) throw new HttpError('Invalid ids', 400, 400)
  if (body.action !== 'delete') throw new HttpError('Invalid action', 400, 400)

  return apiOk(await batchDeleteAdminFiles(ids), 'batch deleted')
})
