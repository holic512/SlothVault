/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Article Detail API
 * @description Reads, updates, restores, or soft-deletes one independent article.
 * @logic Require the administrator role, validate the decimal ID and editable fields, and keep lifecycle state out of generic updates.
 * @dependencies zod, admin session, HTTP helpers, admin article service
 * @index_tags api,admin,article,detail,update,delete
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import {
  deleteAdminArticle,
  getAdminArticle,
  updateAdminArticle,
} from '@/server/services/admin-articles'

const updateArticleSchema = z.object({
  title: z.unknown().optional(),
  summary: z.unknown().optional(),
  cover: z.unknown().optional(),
  content: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await getAdminArticle(parseDecimalId(id)))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, updateArticleSchema)
  return apiOk(await updateAdminArticle(parseDecimalId(id), body))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await deleteAdminArticle(parseDecimalId(id)), 'deleted')
})
