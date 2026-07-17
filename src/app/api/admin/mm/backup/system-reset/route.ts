/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Reset API
 * @description Resets selected business database and upload storage state while preserving authentication data.
 * @logic Require the destructive confirmation phrase and at least one target, stage visible files for rollback, delete business tables in one transaction, and expose the legacy deletion statistics on success.
 * @dependencies admin session, HTTP route helpers, admin backup reset service
 * @index_tags api,admin,backup,system-reset,database,files,rollback
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { resetSystem } from '@/server/services/admin-backup'

const resetSchema = z.object({
  confirm: z.unknown().optional(),
  clearDatabase: z.unknown().optional(),
  clearFiles: z.unknown().optional(),
}).strict()

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, resetSchema)
  if (body.confirm !== 'RESET_ALL_DATA') {
    throw new HttpError(
      'Invalid confirmation code. Please send { "confirm": "RESET_ALL_DATA" } to proceed.',
      400,
      400,
    )
  }

  const clearDatabase = body.clearDatabase === undefined ? true : body.clearDatabase
  const clearFiles = body.clearFiles === undefined ? true : body.clearFiles
  if (typeof clearDatabase !== 'boolean' || typeof clearFiles !== 'boolean') {
    throw new HttpError('Invalid reset options', 400, 400)
  }
  if (!clearDatabase && !clearFiles) {
    throw new HttpError('Select at least one reset target', 400, 400)
  }

  try {
    return apiOk(await resetSystem({ clearDatabase, clearFiles }))
  } catch (error) {
    console.error('[backup] System reset failed', error)
    throw new HttpError('System reset failed', 500, 500)
  }
})
