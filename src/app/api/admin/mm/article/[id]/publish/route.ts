/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Article Publish API
 * @description Publishes a complete independent article while preserving its first publication timestamp.
 * @logic Require an administrator and delegate publication validation and cache invalidation to the article service.
 * @dependencies admin session, HTTP helpers, admin article service
 * @index_tags api,admin,article,publish
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { publishAdminArticle } from '@/server/services/admin-articles'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await publishAdminArticle(parseDecimalId(id)), 'published')
})
