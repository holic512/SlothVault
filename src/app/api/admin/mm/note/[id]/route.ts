/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note API
 * @description Reads, updates, and soft-deletes one note metadata record.
 * @logic Authenticate and parse route/body inputs, then delegate active-parent checks and compatible note mutations to the notes service.
 * @dependencies admin session, HTTP route helpers, admin catalog parsing, admin notes service
 * @index_tags api,admin,note,detail,update,delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import {
  deleteAdminNote,
  getAdminNote,
  updateAdminNote,
} from '@/server/services/admin-notes'

const updateNoteSchema = z.object({
  categoryId: z.unknown().optional(),
  noteTitle: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)

  return apiOk(await getAdminNote(id))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateNoteSchema)
  return apiOk(await updateAdminNote(id, body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  await deleteAdminNote(id)
  return apiOk(null, 'deleted')
})
