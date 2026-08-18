/**
 * @file route.ts
 * @project SlothVault
 * @module Account Contract Decline API
 * @description Records the designated user's optional reason for rejecting a pending contract.
 * @logic Bind the response to the active Web2 session and allow a one-way transition only from the pending state.
 * @dependencies Zod, user session, HTTP helpers, contracts service
 * @index_tags api,account,contracts,decline,authorization,audit
 * @author holic512
 */
import { z } from 'zod'

import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId, readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { declineUserContract } from '@/server/services/contracts'

const schema = z.object({ reason: z.string().max(500).optional() })

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireUserSession(request)
  const { id } = await context.params
  const body = await readJson(request, schema)
  return apiOk(await declineUserContract({
    id: parseBigIntId(id, 'contract id'),
    userId: session.User.id,
    reason: body.reason,
  }))
})
