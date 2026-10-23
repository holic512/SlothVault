/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Homepage Cover API
 * @description Reads and explicitly saves the independent optional homepage cover settings.
 * @logic Require administrator authorization before bounded JSON parsing and delegate transactional image validation and persistence.
 * @dependencies admin session, HTTP helpers, homepage cover service
 * @index_tags api,admin,homepage,cover,get,put
 * @author holic512
 */
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getHomepageCoverSettings, saveHomepageCoverSettings } from '@/server/services/homepage-cover'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute(async request => {
  await requireAdminSession(request)
  return apiOk(await getHomepageCoverSettings())
})

export const PUT = defineRoute(async request => {
  await requireAdminSession(request)
  const input = await readJson(request, z.unknown(), { maxBytes: 2048 })
  return apiOk(await saveHomepageCoverSettings(input), 'saved')
})
