/**
 * @file route.ts
 * @project SlothVault
 * @module Gift Card Redemption API
 * @description Atomically redeems one issued card into the current user's point account.
 * @logic Require the user session, rate-limit attempts, hash the submitted code, consume it once, and append the resulting point ledger entry.
 * @dependencies zod, session service, points service, in-memory rate limit
 * @index_tags api,account,gift-card,redeem,points
 * @author holic512
 */
import { z } from 'zod'

import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/short-lived-state'
import { redeemGiftCard } from '@/server/services/points'

const redeemSchema = z.object({ code: z.string().trim().min(10).max(64) })

export const POST = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  await enforceRateLimit({
    scope: 'gift-card-redeem',
    identity: `${session.userId}:${requestClientIp(request)}`,
    limit: 12,
    windowSeconds: 15 * 60,
  })
  const body = await readJson(request, redeemSchema)
  return apiOk(await redeemGiftCard(session.userId, body.code))
})
