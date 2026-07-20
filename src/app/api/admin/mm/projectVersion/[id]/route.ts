/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Updates or soft-deletes one project version by decimal identifier.
 * @logic Authenticate and parse route/body inputs, then delegate parent validation, update, and soft-delete behavior to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project-version,update,delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  deleteAdminProjectVersion,
  parseDecimalId,
  updateAdminProjectVersion,
} from '@/server/services/admin-catalog'

const updateProjectVersionSchema = z.object({
  projectId: z.unknown().optional(),
  version: z.unknown().optional(),
  description: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateProjectVersionSchema)
  return apiOk(await updateAdminProjectVersion(id, body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  return apiOk(await deleteAdminProjectVersion(id))
})
