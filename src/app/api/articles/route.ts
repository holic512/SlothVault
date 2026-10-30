/**
 * @file route.ts
 * @project SlothVault
 * @module Public Article Archive API
 * @description Returns a bounded batch of public article summaries for continuous browsing.
 * @logic Validate the page at the HTTP boundary and reuse the public metadata cache and shared route handler.
 * @dependencies zod, defineRoute, apiOk, public-article-cache
 * @index_tags articles,public,archive,api
 * @author holic512
 */
import { z } from 'zod'

import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getCachedPublicArticleList } from '@/server/services/public-article-cache'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const page = z.coerce.number().int().positive().max(1_000_000).parse(request.nextUrl.searchParams.get('page') ?? 1)
  return apiOk(await getCachedPublicArticleList(page))
})
