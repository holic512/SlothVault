/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project API
 * @description Reads, updates, and soft-deletes one project by decimal identifier.
 * @logic Authenticate, parse route/body inputs, and delegate compatible detail, update, and soft-delete behavior to the catalog service.
 * @dependencies admin session, HTTP route helpers, admin catalog service
 * @index_tags api,admin,project,detail,update,delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  deleteAdminProject,
  getAdminProject,
  parseDecimalId,
  updateAdminProject,
} from '@/server/services/admin-catalog'

const updateProjectSchema = z.object({
  projectName: z.unknown().optional(),
  avatar: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)

  return apiOk(await getAdminProject(id))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateProjectSchema)
  return apiOk(await updateAdminProject(id, body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  return apiOk(await deleteAdminProject(id))
})
