/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Homepage API
 * @description Updates the Markdown, publication status, or soft-delete state of one system homepage.
 * @logic Authenticate, parse the identifier and JSON payload, delegate the update command, and wrap the stable response.
 * @dependencies admin session, server/http helpers, admin catalog parser, admin content service
 * @index_tags api,admin,system-homepage,update
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
import { parseDecimalId } from '@/server/services/admin-catalog'
import { updateSystemHomepage } from '@/server/services/admin-content'

const updateHomepageSchema = z.object({
  content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateHomepageSchema, {
    maxBytes: DOCUMENT_JSON_MAX_BYTES,
  })
  return apiOk(await updateSystemHomepage(id, body))
})
