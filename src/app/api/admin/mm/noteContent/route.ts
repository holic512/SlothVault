/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note Content API
 * @description Lists and creates versioned note content for authenticated administrators.
 * @logic Authenticate and parse the note-scoped query/body before delegating list and serialized primary-version creation to the notes service.
 * @dependencies admin session, HTTP route helpers, admin catalog parsing, admin notes service
 * @index_tags api,admin,note-content,list,create,primary-version
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  legacyBoolean,
  parseDecimalId,
} from '@/server/services/admin-catalog'
import {
  createAdminNoteContent,
  listAdminNoteContents,
} from '@/server/services/admin-notes'

const createNoteContentSchema = z.object({
  noteInfoId: z.unknown().optional(),
  content: z.unknown().optional(),
  versionNote: z.unknown().optional(),
  isPrimary: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const searchParams = request.nextUrl.searchParams
  const noteInfoIdRaw = searchParams.get('noteInfoId')
  if (noteInfoIdRaw === null) throw new HttpError('Missing noteInfoId', 400, 400)
  const noteInfoId = parseDecimalId(noteInfoIdRaw, 'noteInfoId')
  const includeDeleted = legacyBoolean(searchParams.get('includeDeleted'))
  return apiOk(await listAdminNoteContents(noteInfoId, includeDeleted))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createNoteContentSchema)
  return apiOk(await createAdminNoteContent(body), 'created', 201)
})
