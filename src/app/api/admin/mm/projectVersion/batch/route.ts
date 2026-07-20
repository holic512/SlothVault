/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Applies authenticated bulk changes to project versions.
 * @logic Parse the bounded batch payload and delegate validation and version state changes to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project-version,batch,restore
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { applyAdminProjectVersionBatch } from '@/server/services/admin-catalog'

const batchProjectVersionSchema = z.object({
  action: z.unknown().optional(),
  ids: z.unknown().optional(),
  status: z.unknown().optional(),
  projectId: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, batchProjectVersionSchema)
  return apiOk(await applyAdminProjectVersionBatch(body))
})
