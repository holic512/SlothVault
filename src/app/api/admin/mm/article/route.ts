/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Article Collection API
 * @description Lists and creates independent blog articles for authenticated administrators.
 * @logic Parse bounded filters or a draft payload, require the administrator session, and delegate persistence to the article service.
 * @dependencies zod, admin session, HTTP helpers, admin article service
 * @index_tags api,admin,article,list,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { integerValue, legacyBoolean, pagination } from '@/server/services/admin-catalog'
import { createAdminArticle, listAdminArticles } from '@/server/services/admin-articles'

const createArticleSchema = z.object({
  title: z.unknown().optional(),
  summary: z.unknown().optional(),
  cover: z.unknown().optional(),
  content: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const searchParams = request.nextUrl.searchParams
  const { page, pageSize, skip } = pagination(searchParams)
  const statusRaw = searchParams.get('status')
  const status = statusRaw === null ? undefined : integerValue(statusRaw, Number.NaN)

  return apiOk(await listAdminArticles({
    page,
    pageSize,
    skip,
    keyword: searchParams.get('keyword')?.trim() || '',
    status,
    includeDeleted: legacyBoolean(searchParams.get('includeDeleted')),
  }))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createArticleSchema)
  return apiOk(await createAdminArticle(body), 'created', 201)
})
