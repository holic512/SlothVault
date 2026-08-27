/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Membership Level API
 * @description Lists and creates configurable membership levels for point-priced article access.
 * @logic Require an administrator session, validate bounded commercial fields, and delegate cache-aware persistence to the membership service.
 * @dependencies zod, admin session, HTTP route helpers, membership service
 * @index_tags api,admin,membership,level,create,list
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  createMembershipLevel,
  listMembershipLevels,
} from '@/server/services/membership'

const levelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rank: z.number().int().min(1).max(32_767),
  pricePoints: z.number().int().min(1).max(1_000_000),
  validityDays: z.number().int().min(1).max(36_500).nullable(),
  status: z.union([z.literal(0), z.literal(1)]).default(1),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await listMembershipLevels({
    includeDisabled: request.nextUrl.searchParams.get('includeDisabled') === '1',
  }))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, levelSchema)
  return apiOk(await createMembershipLevel(body), 'created', 201)
})
