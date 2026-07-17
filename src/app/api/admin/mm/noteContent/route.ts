/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note Content API
 * @description Lists and creates versioned note content for authenticated administrators.
 * @logic Validate an active NoteInfo parent, preserve legacy list ordering, and delegate serialized primary-version creation to the notes service.
 * @dependencies admin session, HTTP route helpers, Prisma NoteContent model, admin notes service
 * @index_tags api,admin,note-content,list,create,primary-version
 * @author holic512
 */
import type { Prisma } from '@generated/prisma/client'
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  integerValue,
  legacyBoolean,
  parseDecimalId,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'
import {
  createNoteContent,
  noteContentDto,
  requireActiveNoteInfo,
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
  await requireActiveNoteInfo(noteInfoId)

  const where: Prisma.NoteContentWhereInput = { noteInfoId }
  if (!includeDeleted) where.isDeleted = false
  const list = await prisma.noteContent.findMany({
    where,
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  })
  return apiOk({ list: list.map(noteContentDto) })
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createNoteContentSchema)
  const noteInfoId = parseJsonDecimalId(body.noteInfoId, 'noteInfoId')

  const item = await createNoteContent({
    noteInfoId,
    content: typeof body.content === 'string' ? body.content : '',
    versionNote:
      typeof body.versionNote === 'string' ? body.versionNote.trim() || null : null,
    isPrimary: body.isPrimary === true,
    status: integerValue(body.status, 1),
  })
  return apiOk(noteContentDto(item), 'created', 201)
})
