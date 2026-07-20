/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note Content API
 * @description Updates or soft-deletes one note content version.
 * @logic Authenticate and parse route/body inputs, then delegate every mutation to a parent-revision transaction that restores the primary-version invariant.
 * @dependencies admin session, HTTP route helpers, admin catalog parsing, admin notes service
 * @index_tags api,admin,note-content,update,delete,transaction
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import {
  deleteAdminNoteContent,
  updateAdminNoteContent,
} from '@/server/services/admin-notes'

const updateNoteContentSchema = z.object({
  content: z.unknown().optional(),
  versionNote: z.unknown().optional(),
  isPrimary: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateNoteContentSchema)
  return apiOk(await updateAdminNoteContent(id, body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  await deleteAdminNoteContent(id)
  return apiOk(null, 'deleted')
})
