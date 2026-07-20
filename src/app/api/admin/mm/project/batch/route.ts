/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project API
 * @description Applies authenticated bulk state changes to projects.
 * @logic Parse the bounded batch payload and delegate validation and project state changes to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project,batch,restore
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { applyAdminProjectBatch } from '@/server/services/admin-catalog'

const batchProjectSchema = z.object({
  action: z.unknown().optional(),
  ids: z.unknown().optional(),
  status: z.unknown().optional(),
  requireAuth: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, batchProjectSchema)
  return apiOk(await applyAdminProjectBatch(body))
})
