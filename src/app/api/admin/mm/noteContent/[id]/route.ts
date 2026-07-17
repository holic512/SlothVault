/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note Content API
 * @description Updates or soft-deletes one note content version.
 * @logic Authenticate, validate editable fields, and delegate every mutation to a parent-row-locked transaction that restores the primary-version invariant.
 * @dependencies admin session, HTTP route helpers, admin catalog parsing, admin notes service
 * @index_tags api,admin,note-content,update,delete,transaction
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  optionalIntegerValue,
  parseDecimalId,
} from '@/server/services/admin-catalog'
import {
  deleteNoteContent,
  noteContentDto,
  updateNoteContent,
  type UpdateNoteContentInput,
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
  const input: UpdateNoteContentInput = {}

  if (typeof body.content === 'string') input.content = body.content
  if (body.versionNote !== undefined) {
    input.versionNote =
      typeof body.versionNote === 'string' ? body.versionNote.trim() || null : null
  }
  const status = optionalIntegerValue(body.status)
  if (status !== null) input.status = status
  if (typeof body.isDeleted === 'boolean') input.isDeleted = body.isDeleted
  if (body.isPrimary === true) input.isPrimary = true

  if (Object.keys(input).length === 0) {
    throw new HttpError('No fields to update', 400, 400)
  }

  const item = await updateNoteContent(id, input)
  return apiOk(noteContentDto(item))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  await deleteNoteContent(id)
  return apiOk(null, 'deleted')
})
