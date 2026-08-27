/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Membership Level Detail API
 * @description Updates one retained membership level without deleting historical article or grant references.
 * @logic Require an administrator session, validate only supplied mutable fields, and preserve referenced levels through status changes rather than deletion.
 * @dependencies zod, admin session, HTTP route helpers, membership service, admin catalog IDs
 * @index_tags api,admin,membership,level,update
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { updateMembershipLevel } from '@/server/services/membership'

const updateLevelSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rank: z.number().int().min(1).max(32_767).optional(),
  pricePoints: z.number().int().min(1).max(1_000_000).optional(),
  validityDays: z.number().int().min(1).max(36_500).nullable().optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
}).refine((value) => Object.keys(value).length > 0)

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, updateLevelSchema)
  return apiOk(await updateMembershipLevel({ id: parseDecimalId(id), ...body }))
})
