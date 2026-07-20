/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Menu API
 * @description Reads, edits/restores, and cascade-deletes one project menu inside a two-level hierarchy.
 * @logic Authenticate, parse path/query/body inputs, delegate transactional menu commands, and wrap compatibility responses.
 * @dependencies admin session, server/http helpers, admin catalog parser, admin content service
 * @index_tags api,admin,project-menu,update,restore,cascade-delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  legacyBoolean,
  parseDecimalId,
} from '@/server/services/admin-catalog'
import {
  deleteProjectMenu,
  getProjectMenu,
  updateProjectMenu,
} from '@/server/services/admin-content'

const updateMenuSchema = z.object({
  parentId: z.unknown().optional(),
  label: z.unknown().optional(),
  url: z.unknown().optional(),
  isExternal: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  return apiOk(await getProjectMenu(id))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateMenuSchema)
  return apiOk(await updateProjectMenu(id, body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const hard = legacyBoolean(request.nextUrl.searchParams.get('hard'))
  await deleteProjectMenu(id, hard)
  return apiOk(null, 'deleted')
})
