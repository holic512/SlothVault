/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Evidence Attempt Cancellation API
 * @description Closes an unsigned wallet request and leaves it eligible for a fresh retry.
 * @logic Authenticate the administrator, retain the cancellation reason on the attempt, and record the action audit.
 * @dependencies Zod, admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,evidence,wallet,cancel,audit
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId, readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { cancelContractEvidenceAttempt } from '@/server/services/contracts'

const schema = z.object({ reason: z.string().max(500).optional() })

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, schema)
  return apiOk(await cancelContractEvidenceAttempt({
    attemptId: parseBigIntId(id, 'attempt id'),
    issuerUserId: session.User.id,
    reason: body.reason,
  }))
})
