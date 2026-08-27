/**
 * @file route.ts
 * @project SlothVault
 * @module Account Membership API
 * @description Returns the signed-in user's membership state and exchanges points for a selected active level.
 * @logic Require an active user session, throttle purchases by user and client IP, and delegate the atomic point-and-grant transaction to the membership service.
 * @dependencies zod, user session, request IP, rate limiter, membership service
 * @index_tags api,account,membership,points,purchase,rate-limit
 * @author holic512
 */
import { z } from 'zod'

import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/short-lived-state'
import { getMembershipAccountData, purchaseMembership } from '@/server/services/membership'

const purchaseSchema = z.object({
  membershipLevelId: z.number().int().positive().safe(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  return apiOk(await getMembershipAccountData(session.userId))
})

export const POST = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  await enforceRateLimit({
    scope: 'membership-purchase',
    identity: `${session.userId}:${requestClientIp(request)}`,
    limit: 12,
    windowSeconds: 15 * 60,
  })
  const body = await readJson(request, purchaseSchema)
  return apiOk(await purchaseMembership({ userId: session.userId, ...body }), 'purchased')
})
