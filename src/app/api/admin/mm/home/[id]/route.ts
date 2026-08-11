/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Homepage API
 * @description Reads, updates/restores, or deletes a project homepage record.
 * @logic Authenticate, parse the path/query/body inputs, delegate homepage commands, and wrap compatibility responses.
 * @dependencies admin session, server/http helpers, admin catalog parser, admin content service
 * @index_tags api,admin,project-home,update,restore,delete
 * @author holic512
 */
import { z } from 'zod'

import {
  DOCUMENT_CONTENT_MAX_CHARACTERS,
  DOCUMENT_JSON_MAX_BYTES,
} from '@/lib/document-content'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { legacyBoolean, parseDecimalId } from '@/server/services/admin-catalog'
import {
  deleteProjectHome,
  getProjectHome,
  updateProjectHome,
} from '@/server/services/admin-content'

const updateHomeSchema = z.object({
  content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  return apiOk(await getProjectHome(id))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateHomeSchema, {
    maxBytes: DOCUMENT_JSON_MAX_BYTES,
  })
  return apiOk(await updateProjectHome(id, body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const hard = legacyBoolean(request.nextUrl.searchParams.get('hard'))
  await deleteProjectHome(id, hard)
  return apiOk(null, 'deleted')
})
